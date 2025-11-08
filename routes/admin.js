// routes/admin.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/dashboard", async (req, res) => {
  try {
    // 1. autos publicados
    const [[{ publicados }]] = await pool.query(
      "SELECT COUNT(*) AS publicados FROM cars WHERE status = 'available'"
    );

    // 2. autos vendidos
    const [[{ vendidos }]] = await pool.query(
      "SELECT COUNT(*) AS vendidos FROM cars WHERE status = 'sold'"
    );

    // 3. autos reservados
    const [[{ reservados }]] = await pool.query(
      "SELECT COUNT(*) AS reservados FROM cars WHERE status = 'reserved'"
    );

    // 4. ingresos del mes
    const [[{ ingresos }]] = await pool.query(
      `SELECT IFNULL(SUM(precio_final), 0) AS ingresos
       FROM sales
       WHERE MONTH(fecha_venta) = MONTH(CURDATE())
         AND YEAR(fecha_venta) = YEAR(CURDATE())`
    );

    // 5. movimientos recientes
    const [movimientos] = await pool.query(
      `SELECT s.id,
              s.cliente_nombre,
              s.fecha_venta,
              c.marca,
              c.modelo
       FROM sales s
       JOIN cars c ON c.id = s.car_id
       ORDER BY s.fecha_venta DESC
       LIMIT 5`
    );

    res.render("admin/dashboard", {
      publicados,
      vendidos,
      reservados,
      ingresos,
      movimientos,
    });
  } catch (err) {
    console.error("Error en dashboard admin:", err);
    res.render("admin/dashboard", {
      publicados: 0,
      vendidos: 0,
      reservados: 0,
      ingresos: 0,
      movimientos: [],
    });
  }
});

export default router;
