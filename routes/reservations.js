// routes/reservations.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

// proteger
function ensureLogged(req, res, next) {
  if (!req.session || !req.session.user) {
    const backTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${backTo}`);
  }
  next();
}

// alias para no romper el header viejo
router.get("/mis-rentas", ensureLogged, (req, res) => {
  return res.redirect("/reservations");
});


// GET: mostrar formulario
router.get("/cars/:id/reserve", ensureLogged, async (req, res) => {
  const carId = req.params.id;

  const [[car]] = await pool.query("SELECT * FROM cars WHERE id = ?", [carId]);

  if (!car) {
    return res.status(404).send("Auto no encontrado");
  }

  const [reservations] = await pool.query(
    `SELECT start_date, end_date
     FROM reservations
     WHERE car_id = ? AND status <> 'cancelled'`,
    [carId]
  );

  res.render("reserve_car", {
    car,
    reservations,
    errors: [],
    formData: {}
  });
});

// POST: guardar reserva
router.post("/cars/:id/reserve", ensureLogged, async (req, res) => {
  const carId = req.params.id;
  const userId = req.session.user.id;

  const {
    dateRange,
    first_name,
    last_name,
    email,
    paymentMethod,
    cc_name,
    cc_number,
    cc_exp,
    cc_cvv,
    notes
  } = req.body;

  const errors = [];

  if (!dateRange || dateRange.trim() === "") {
    errors.push("Debes seleccionar un rango de fechas.");
  }
  if (!first_name || first_name.trim() === "") {
    errors.push("El nombre es obligatorio.");
  }
  if (!last_name || last_name.trim() === "") {
    errors.push("Los apellidos son obligatorios.");
  }
  if (!email || email.trim() === "") {
    errors.push("El correo es obligatorio.");
  }
  if (!paymentMethod || paymentMethod.trim() === "") {
    errors.push("Debes seleccionar un método de pago.");
  }

  if (paymentMethod === "credit" || paymentMethod === "debit") {
    if (!cc_name || cc_name.trim() === "") errors.push("El nombre en la tarjeta es obligatorio.");
    if (!cc_number || cc_number.trim() === "") errors.push("El número de tarjeta es obligatorio.");
    if (!cc_exp || cc_exp.trim() === "") errors.push("La fecha de expiración es obligatoria.");
    if (!cc_cvv || cc_cvv.trim() === "") errors.push("El CVV es obligatorio.");
  }

  if (errors.length > 0) {
    const [[car]] = await pool.query("SELECT * FROM cars WHERE id = ?", [carId]);
    const [reservations] = await pool.query(
      `SELECT start_date, end_date
       FROM reservations
       WHERE car_id = ? AND status <> 'cancelled'`,
      [carId]
    );

    return res.status(400).render("reserve_car", {
      car,
      reservations,
      errors,
      formData: {
        first_name,
        last_name,
        email,
        notes,
        paymentMethod,
        cc_name,
        cc_number,
        cc_exp,
        cc_cvv
      }
    });
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

  // después de crear, vamos a la vista
  return res.redirect("/reservations");
});

//  NUEVA RUTA AQUÍ
router.get("/reservations", ensureLogged, async (req, res) => {
  const userId = req.session.user.id;

  const [rows] = await pool.query(
    `
    SELECT r.id,
          r.start_date,
          r.end_date,
          r.status,
          c.brand,
          c.model,
          c.image_url,
          c.price_per_day
    FROM reservations r
    JOIN cars c ON r.car_id = c.id
    WHERE r.user_id = ?
    ORDER BY r.start_date DESC
    `,
    [userId]
  );

  res.render("reservations", {
    reservations: rows,
  });
});

// CANCELAR una reserva
router.post("/reservas/:id/cancel", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;

  // verificar que la reserva sea del usuario
  const [[reserva]] = await pool.query(
    `SELECT id, user_id FROM reservations WHERE id = ?`,
    [reservaId]
  );

  if (!reserva) {
    return res.status(404).send("Reserva no encontrada");
  }

  // si no es dueño y no es admin -> no
  if (reserva.user_id !== userId && (!req.session.user || req.session.user.role !== "admin")) {
    return res.status(403).send("No puedes cancelar esta reserva");
  }

  await pool.query(
    `UPDATE reservations SET status = 'cancelled' WHERE id = ?`,
    [reservaId]
  );

  return res.redirect("/reservations");
});

// FORMULARIO para reprogramar
router.get("/reservas/:id/editar", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;

  // traemos la reserva con el auto
  const [[reserva]] = await pool.query(
    `
    SELECT r.id, r.car_id, r.user_id, r.start_date, r.end_date, r.status,
           c.brand, c.model, c.image_url, c.price_per_day
    FROM reservations r
    JOIN cars c ON r.car_id = c.id
    WHERE r.id = ?
    `,
    [reservaId]
  );

  if (!reserva) {
    return res.status(404).send("Reserva no encontrada");
  }

  if (reserva.user_id !== userId && (!req.session.user || req.session.user.role !== "admin")) {
    return res.status(403).send("No puedes editar esta reserva");
  }

  const [otrasReservas] = await pool.query(
    `
    SELECT start_date, end_date
    FROM reservations
    WHERE car_id = ?
      AND id <> ?
      AND status <> 'cancelled'
    `,
    [reserva.car_id, reservaId]
  );

  // renderizamos una vista muy parecida a reservar
  res.render("edit_reservation", {
    reserva,
    car: {
      id: reserva.car_id,
      brand: reserva.brand,
      model: reserva.model,
      image_url: reserva.image_url,
      price_per_day: reserva.price_per_day,
    },
    reservations: otrasReservas,
    errors: [],
  });
});

// GUARDAR reprogramación
router.post("/reservas/:id/editar", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;
  const { dateRange } = req.body;

  const [[reserva]] = await pool.query(
    `SELECT id, user_id, car_id FROM reservations WHERE id = ?`,
    [reservaId]
  );

  if (!reserva) {
    return res.status(404).send("Reserva no encontrada");
  }

  if (reserva.user_id !== userId && (!req.session.user || req.session.user.role !== "admin")) {
    return res.status(403).send("No puedes editar esta reserva");
  }

  if (!dateRange || dateRange.trim() === "") {
    const [otrasReservas] = await pool.query(
      `
      SELECT start_date, end_date
      FROM reservations
      WHERE car_id = ?
        AND id <> ?
        AND status <> 'cancelled'
      `,
      [reserva.car_id, reservaId]
    );

    const [[car]] = await pool.query(
      `SELECT * FROM cars WHERE id = ?`,
      [reserva.car_id]
    );

    return res.status(400).render("edit_reservation", {
      reserva,
      car,
      reservations: otrasReservas,
      errors: ["Debes seleccionar un rango de fechas."]
    });
  }

  const [start_date, end_date] = dateRange.split(" to ");

  await pool.query(
    `UPDATE reservations
     SET start_date = ?, end_date = ?
     WHERE id = ?`,
    [start_date, end_date, reservaId]
  );

  return res.redirect("/reservations");
});


export default router;
