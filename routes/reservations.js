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

// GET: mostrar formulario de reserva de un auto
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
    formData: {},
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
    notes,
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
    if (!cc_name || cc_name.trim() === "")
      errors.push("El nombre en la tarjeta es obligatorio.");
    if (!cc_number || cc_number.trim() === "")
      errors.push("El número de tarjeta es obligatorio.");
    if (!cc_exp || cc_exp.trim() === "")
      errors.push("La fecha de expiración es obligatoria.");
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
        cc_cvv,
      },
    });
  }

  // flatpickr manda "YYYY-MM-DD to YYYY-MM-DD"
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

  return res.redirect("/mis_reservas");
});

// LISTAR reservas del usuario
router.get("/mis_reservas", ensureLogged, async (req, res) => {
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

// alias por si la navbar usa /mis-rentas
router.get("/mis-rentas", ensureLogged, (req, res) => {
  // conservar query params si vienen (?refund=1&amount=...)
  const query = req.url.split("?")[1];
  if (query) {
    return res.redirect(`/mis_reservas?${query}`);
  }
  return res.redirect("/mis_reservas");
});

// CANCELAR una reserva
router.post("/reservas/:id/cancel", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;

  const [[reserva]] = await pool.query(
    `SELECT id, user_id FROM reservations WHERE id = ?`,
    [reservaId]
  );

  if (!reserva) {
    return res.status(404).send("Reserva no encontrada");
  }

  if (reserva.user_id !== userId && req.session.user.role !== "admin") {
    return res.status(403).send("No puedes cancelar esta reserva");
  }

  await pool.query(
    `UPDATE reservations SET status = 'cancelled' WHERE id = ?`,
    [reservaId]
  );

  return res.redirect("/mis_reservas");
});

// GET: formulario para reprogramar
router.get("/reservas/:id/editar", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;

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

  if (reserva.user_id !== userId && req.session.user.role !== "admin") {
    return res.status(403).send("No puedes editar esta reserva");
  }

  // otras reservas de ese auto para bloquear fechas, excepto esta
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

// POST: guardar reprogramación (si hay más días, cobrar; si hay menos, avisar)
router.post("/reservas/:id/editar", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;
  const { dateRange } = req.body;

  const [[reserva]] = await pool.query(
    `SELECT id, user_id, car_id, start_date, end_date
     FROM reservations
     WHERE id = ?`,
    [reservaId]
  );

  if (!reserva) return res.status(404).send("Reserva no encontrada");
  if (reserva.user_id !== userId && req.session.user.role !== "admin") {
    return res.status(403).send("No puedes editar esta reserva");
  }

  if (!dateRange || dateRange.trim() === "") {
    const [otrasReservas] = await pool.query(
      `SELECT start_date, end_date
       FROM reservations
       WHERE car_id = ? AND id <> ? AND status <> 'cancelled'`,
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
      errors: ["Debes seleccionar un rango de fechas."],
    });
  }

  const [new_start, new_end] = dateRange.split(" to ");

  const msPerDay = 1000 * 60 * 60 * 24;
  const oldDays =
    Math.round(
      (new Date(reserva.end_date) - new Date(reserva.start_date)) / msPerDay
    ) + 1;
  const newDays =
    Math.round((new Date(new_end) - new Date(new_start)) / msPerDay) + 1;

  // precio del auto
  const [[car]] = await pool.query(
    "SELECT price_per_day, brand, model, image_url FROM cars WHERE id = ?",
    [reserva.car_id]
  );
  const pricePerDay = Number(car?.price_per_day || 0);

  // si son MÁS días → cobrar diferencia
  const extraDays = Math.max(0, newDays - oldDays);
  const extraAmount = extraDays * pricePerDay;

  if (extraAmount > 0) {
    return res.render("pay_difference", {
      reservaId,
      car,
      new_start,
      new_end,
      extraAmount,
      oldDays,
      newDays,
      pricePerDay,
      error: null,
    });
  }

  // si son MENOS días → actualizar y mandar query para que el front muestre el mensaje
  await pool.query(
    `UPDATE reservations
     SET start_date = ?, end_date = ?
     WHERE id = ?`,
    [new_start, new_end, reservaId]
  );

  const diasMenos = Math.max(0, oldDays - newDays);
  const refundAmount = diasMenos * pricePerDay;

  return res.redirect(
    `/mis_reservas?refund=1&menos=${diasMenos}&amount=${refundAmount}`
  );
});

// POST: pagar diferencia y aplicar reprogramación
router.post("/reservas/:id/pagar_diferencia", ensureLogged, async (req, res) => {
  const reservaId = req.params.id;
  const userId = req.session.user.id;
  const {
    new_start,
    new_end,
    extraAmount,
    paymentMethod,
    cc_name,
    cc_number,
    cc_exp,
    cc_cvv,
  } = req.body;

  if (!new_start || !new_end) {
    return res.status(400).send("Faltan fechas nuevas.");
  }

  // 1. Traer reserva original
  const [[reserva]] = await pool.query(
    `SELECT id, user_id, car_id, start_date, end_date
     FROM reservations
     WHERE id = ?`,
    [reservaId]
  );

  if (!reserva) return res.status(404).send("Reserva no encontrada");
  if (reserva.user_id !== userId && req.session.user.role !== "admin") {
    return res.status(403).send("No puedes editar esta reserva");
  }

  // 2. Traer auto para precio
  const [[car]] = await pool.query(
    "SELECT price_per_day, brand, model, image_url FROM cars WHERE id = ?",
    [reserva.car_id]
  );
  const pricePerDay = Number(car?.price_per_day || 0);

  // 3. Recalcular diferencia en el servidor
  const msPerDay = 1000 * 60 * 60 * 24;
  const oldDays =
    Math.round(
      (new Date(reserva.end_date) - new Date(reserva.start_date)) / msPerDay
    ) + 1;
  const newDays =
    Math.round((new Date(new_end) - new Date(new_start)) / msPerDay) + 1;
  const extraDays = Math.max(0, newDays - oldDays);
  const serverExtra = extraDays * pricePerDay;

  // 4. Si realmente hay que cobrar, validar pago
  if (serverExtra > 0) {
    if (paymentMethod === "credit" || paymentMethod === "debit") {
      if (!cc_name || !cc_number || !cc_exp || !cc_cvv) {
        return res.status(400).render("pay_difference", {
          reservaId,
          car,
          new_start,
          new_end,
          extraAmount: serverExtra,
          oldDays,
          newDays,
          pricePerDay,
          error: "Completa los datos de pago.",
        });
      }
    }

    // aquí la pasarela real
    console.log(`Cobrar ${serverExtra} MXN por diferencia de días`);
  }

  // 5. Guardar las nuevas fechas
  await pool.query(
    `UPDATE reservations
     SET start_date = ?, end_date = ?
     WHERE id = ?`,
    [new_start, new_end, reservaId]
  );

  //  endpoint SOLO para pagar diferencia
  return res.redirect("/mis_reservas?paid=1");
});

export default router;
