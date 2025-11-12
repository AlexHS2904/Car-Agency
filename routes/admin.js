// routes/admin.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ======================================================
   DASHBOARD  -  GET /admin/dashboard
   ====================================================== */
router.get("/dashboard", async (_req, res) => {
  try {
    const [[{ publicados }]] = await pool.query(
      "SELECT COUNT(*) AS publicados FROM cars WHERE status IN ('available','publicado')"
    );

    const [[{ vendidos }]] = await pool.query(
      "SELECT COUNT(*) AS vendidos FROM cars WHERE status = 'sold'"
    );

    const [[{ reservados }]] = await pool.query(
      "SELECT COUNT(*) AS reservados FROM reservations WHERE status <> 'cancelled'"
    );

    const [[{ reservasMes }]] = await pool.query(
      `SELECT COUNT(*) AS reservasMes
       FROM reservations
       WHERE status <> 'cancelled'
         AND MONTH(created_at) = MONTH(CURDATE())
         AND YEAR(created_at) = YEAR(CURDATE())`
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
      SELECT
        r.id,
        r.created_at,
        r.start_date,
        r.end_date,
        r.status,
        r.total_amount,
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

    const [inventory] = await pool.query(
      `
      SELECT
        c.id,
        c.brand,
        c.model,
        c.year,
        c.price_per_day,
        COALESCE(c.image_url, '') AS image_url,
        COALESCE(c.status, 'available') AS status,
        c.created_at,
        COUNT(r.id) AS reservas_total
      FROM cars c
      LEFT JOIN reservations r ON r.car_id = c.id
      GROUP BY c.id, c.brand, c.model, c.year, c.price_per_day, c.image_url, c.status, c.created_at
      ORDER BY c.id DESC
      LIMIT 10
      `
    );

    return res.render("admin/dashboard", {
      publicados,
      vendidos,
      reservados,
      reservasMes,
      ingresos,
      movimientos,
      inventory,
    });
  } catch (err) {
    console.error("Error en dashboard admin:", err);
    return res.render("admin/dashboard", {
      publicados: 0,
      vendidos: 0,
      reservados: 0,
      reservasMes: 0,
      ingresos: 0,
      movimientos: [],
      inventory: [],
    });
  }
});

/* ======================================================
   VENTAS / RESERVAS  -  GET /admin/ventas
   Soporta filtro ?car_id=...
   ====================================================== */
router.get("/ventas", async (req, res) => {
  try {
    const { car_id } = req.query;

    let sql = `
      SELECT
        r.id,
        r.created_at,
        r.start_date,
        r.end_date,
        r.status,
        r.total_amount,
        u.name  AS user_name,
        u.email AS user_email,
        c.id    AS car_id,
        c.brand,
        c.model
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      JOIN cars  c ON c.id = r.car_id
      WHERE 1=1
    `;
    const params = [];

    if (car_id && String(car_id).trim() !== "") {
      sql += " AND c.id = ? ";
      params.push(car_id);
    }

    sql += " ORDER BY r.created_at DESC";

    const [reservas] = await pool.query(sql, params);
    return res.render("admin/bookings", { reservas, car_id: car_id || "" });
  } catch (err) {
    console.error("Error /admin/ventas:", err);
    return res.status(500).send("Error cargando las reservas.");
  }
});

/* ======================================================
   EDITAR / ELIMINAR RESERVA (ADMIN)
   ====================================================== */

// Formulario editar
router.get("/reservas/:id/editar", async (req, res) => {
  const { id } = req.params;
  const { return_to } = req.query || {};
  try {
    const [[r]] = await pool.query(
      `
      SELECT
        r.id, r.start_date, r.end_date, r.status, r.total_amount,
        u.name AS user_name, u.email AS user_email,
        c.id   AS car_id, c.brand, c.model, c.price_per_day
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      JOIN cars  c ON c.id = r.car_id
      WHERE r.id = ?
      `,
      [id]
    );
    if (!r) return res.status(404).send("Reserva no encontrada.");

    return res.render("admin/booking_edit", { r, error: null, return_to: return_to || "" });
  } catch (err) {
    console.error("GET /admin/reservas/:id/editar:", err);
    return res.status(500).send("Error cargando la reserva.");
  }
});

// Guardar edición
router.post("/reservas/:id/editar", async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date, status, total_amount, return_to } = req.body;

  try {
    const errors = [];
    if (!start_date || !end_date) errors.push("Las fechas son obligatorias.");
    if (!status) errors.push("El estatus es obligatorio.");
    const amountNum = Number(total_amount);
    if (isNaN(amountNum) || amountNum < 0) errors.push("Total inválido.");

    if (errors.length > 0) {
      const [[r]] = await pool.query(
        `
        SELECT
          r.id, r.start_date, r.end_date, r.status, r.total_amount,
          u.name AS user_name, u.email AS user_email,
          c.id   AS car_id, c.brand, c.model, c.price_per_day
        FROM reservations r
        JOIN users u ON u.id = r.user_id
        JOIN cars  c ON c.id = r.car_id
        WHERE r.id = ?
        `,
        [id]
      );
      return res.status(400).render("admin/booking_edit", {
        r,
        error: errors.join(" "),
        return_to: return_to || "",
      });
    }

    await pool.query(
      `UPDATE reservations
       SET start_date = ?, end_date = ?, status = ?, total_amount = ?
       WHERE id = ?`,
      [start_date, end_date, status, amountNum, id]
    );

    if (return_to && return_to.startsWith("/admin/ventas")) {
      return res.redirect(return_to);
    }
    return res.redirect("/admin/ventas");
  } catch (err) {
    console.error("POST /admin/reservas/:id/editar:", err);
    return res.status(500).send("No se pudo actualizar la reserva.");
  }
});

// Eliminar
router.post("/reservas/:id/eliminar", async (req, res) => {
  const { id } = req.params;
  const { return_to } = req.body;
  try {
    await pool.query(`DELETE FROM reservations WHERE id = ?`, [id]);
    if (return_to && return_to.startsWith("/admin/ventas")) {
      return res.redirect(return_to);
    }
    return res.redirect("/admin/ventas");
  } catch (err) {
    console.error("POST /admin/reservas/:id/eliminar:", err);
    return res.status(500).send("No se pudo eliminar la reserva.");
  }
});

export default router;
