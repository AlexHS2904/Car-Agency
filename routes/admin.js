// routes/admin.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// DASHBOARD
router.get("/dashboard", async (req, res) => {
  try {
    const [[{ publicados }]] = await pool.query(
      "SELECT COUNT(*) AS publicados FROM cars WHERE status IN ('available','publicado')"
    );

    const [[{ reservasMes }]] = await pool.query(
      `SELECT COUNT(*) AS reservasMes
       FROM reservations
       WHERE status <> 'cancelled'
         AND MONTH(created_at) = MONTH(CURDATE())
         AND YEAR(created_at) = YEAR(CURDATE())`
    );

    const [[{ reservados }]] = await pool.query(
      "SELECT COUNT(*) AS reservados FROM reservations WHERE status <> 'cancelled'"
    );

    const [[{ ingresos }]] = await pool.query(
      `SELECT IFNULL(SUM(total_amount), 0) AS ingresos
       FROM reservations
       WHERE status <> 'cancelled'
         AND MONTH(created_at) = MONTH(CURDATE())
         AND YEAR(created_at) = YEAR(CURDATE())`
    );

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

    res.render("admin/dashboard", {
      publicados,
      reservasMes,
      reservados,
      ingresos,
      movimientos,
    });
  } catch (err) {
    console.error("Error en dashboard admin:", err);
    res.render("admin/dashboard", {
      publicados: 0,
      reservasMes: 0,
      reservados: 0,
      ingresos: 0,
      movimientos: [],
    });
  }
});

// LISTA COMPLETA → /admin/ventas
router.get("/ventas", async (req, res) => {
  try {
    const [reservas] = await pool.query(
      `
      SELECT r.id,
             r.created_at,
             r.start_date,
             r.end_date,
             r.status,
             r.total_amount,
             c.brand,
             c.model,
             u.name  AS user_name,
             u.email AS user_email
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC
      `
    );

    res.render("admin/bookings", {
      reservas,
    });
  } catch (err) {
    console.error("Error listando reservas admin:", err);
    res.render("admin/bookings", {
      reservas: [],
    });
  }
});

export default router;
