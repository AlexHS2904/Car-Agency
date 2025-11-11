// routes/reservations.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

// proteger
function ensureLogged(req, res, next) {
  if (!req.session || !req.session.user) {
    // guardamos a dónde quería ir
    const backTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${backTo}`);
  }
  next();
}

// GET: mostrar formulario
router.get("/cars/:id/reserve", ensureLogged, async (req, res) => {
  const carId = req.params.id;

  const [[car]] = await pool.query(
    "SELECT * FROM cars WHERE id = ?",
    [carId]
  );

  if (!car) {
    return res.status(404).send("Auto no encontrado");
  }

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

  if (!dateRange) {
    return res.status(400).send("Debes seleccionar un rango de fechas.");
  }

  const [start_date, end_date] = dateRange.split(" to ");

  try {
    await pool.query(
      `INSERT INTO reservations (car_id, user_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'confirmed')`,
      [carId, userId, start_date, end_date]
    );
  } catch (err) {
    console.error("Error insertando reserva:", err);
    return res.status(500).send("No se pudo guardar la reserva.");
  }

  res.redirect("/catalogo");
});

export default router;
