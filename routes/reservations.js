// routes/admin.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/dashboard", async (req, res) => {
  try {
    // 1. autos publicados
    const [[{ publicados }]] = await pool.query(
      "SELECT COUNT(*) AS publicados FROM cars WHERE status IN ('available','publicado')"
    );

    // 2. autos vendidos (lo dejamos como lo tenías)
    const [[{ vendidos }]] = await pool.query(
      "SELECT COUNT(*) AS vendidos FROM cars WHERE status = 'sold'"
    );

    // 3. reservas activas
    const [[{ reservados }]] = await pool.query(
      "SELECT COUNT(*) AS reservados FROM reservations WHERE status <> 'cancelled'"
    );

    // 4. ingresos del mes
    const [[{ ingresos }]] = await pool.query(
      `SELECT IFNULL(SUM(total_amount), 0) AS ingresos
       FROM reservations
       WHERE status <> 'cancelled'
         AND MONTH(created_at) = MONTH(CURDATE())
         AND YEAR(created_at) = YEAR(CURDATE())`
    );

    // 5. movimientos recientes
    const [movimientos] = await pool.query(
      `
      SELECT r.id,
             r.created_at,
             r.start_date,
             r.end_date,
             r.status,
             c.brand,
             c.model,
             u.name AS user_name
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC
      LIMIT 5
      `
    );

    // 6. TODAS las reservas ordenadas por el primero que se hizo
    const [todasLasReservas] = await pool.query(
      `
      SELECT r.id,
             r.created_at,
             r.start_date,
             r.end_date,
             r.status,
             r.total_amount,
             c.brand,
             c.model,
             u.name AS user_name,
             u.email AS user_email
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at ASC
      `
    );

    res.render("admin/dashboard", {
      publicados,
      vendidos,
      reservados,
      ingresos,
      movimientos,
      todasLasReservas,
    });
  } catch (err) {
    console.error("Error en dashboard admin:", err);
    res.render("admin/dashboard", {
      publicados: 0,
      vendidos: 0,
      reservados: 0,
      ingresos: 0,
      movimientos: [],
      todasLasReservas: [],
    });
  }
});

export default router;
