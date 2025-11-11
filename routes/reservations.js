// routes/reservations.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

// proteger
function ensureLogged(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// GET: mostrar formulario
router.get("/cars/:id/reserve", ensureLogged, async (req, res) => {
  const carId = req.params.id;

  // 1) trae el auto
  const [[car]] = await pool.query(
    "SELECT * FROM cars WHERE id = ?",
    [carId]
  );

  if (!car) {
    return res.status(404).send("Auto no encontrado");
  }

  // 2) trae las reservas de ese auto
  let reservations = [];
  try {
    const [rows] = await pool.query(
      `SELECT start_date, end_date
       FROM reservations
       WHERE car_id = ? AND status <> 'cancelled'`,
      [carId]
    );
    reservations = rows;
  } catch (err) {
    reservations = [];
  }

  res.render("reserve_car", {
    car,
    reservations,
  });
});

// POST: guardar reserva
router.post("/cars/:id/reserve", ensureLogged, async (req, res) => {
  const carId = req.params.id;
  const userId = req.session.user.id;
  const dateRange = req.body.dateRange;

  // si no mandaron fechas, regresa
  if (!dateRange) {
    return res.status(400).send("Debes seleccionar un rango de fechas.");
  }

  // flatpickr manda "2025-11-10 to 2025-11-12"
  const [start_date, end_date] = dateRange.split(" to ");

  // validar solapamientos si ya existe la tabla
  try {
    await pool.query(
      `INSERT INTO reservations (car_id, user_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'confirmed')`,
      [carId, userId, start_date, end_date]
    );
  } catch (err) {
    // si la tabla no existe, al menos diga eso
    console.error("Error insertando reserva:", err);
    return res.status(500).send("No se pudo guardar la reserva.");
  }

  // redirige a donde quieras
  res.redirect("/catalogo");
});

export default router;
