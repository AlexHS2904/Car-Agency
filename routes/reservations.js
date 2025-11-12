// routes/reservations.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

/* =========================
   MIDDLEWARE
   ========================= */
function ensureLogged(req, res, next) {
  if (!req.session || !req.session.user) {
    const backTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${backTo}`);
  }
  next();
}

/* =========================
   UTILES
   ========================= */
function parseRange(input) {
  if (!input) return [null, null];
  // flatpickr "range": "YYYY-MM-DD to YYYY-MM-DD" (o " - ")
  let parts = input.split(" to ");
  if (parts.length !== 2) parts = input.split(" - ");
  const [a, b] = parts;
  const start = a ? a.trim() : null;
  const end = b ? b.trim() : null;
  return [start, end];
}

/* =========================
   LISTA DE MIS RENTAS
   ========================= */
router.get("/mis-rentas", ensureLogged, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [rows] = await pool.query(
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
        c.year,
        c.price_per_day,
        COALESCE(c.image_url, '') AS image_url,
        (DATEDIFF(r.end_date, r.start_date) * c.price_per_day) AS computed_total
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      `,
      [userId]
    );

    return res.render("reservations", {
      title: "Mis reservas",
      reservations: rows,
    });
  } catch (err) {
    console.error("Error /mis-rentas:", err);
    return res.status(500).send("Error interno al cargar tus reservas.");
  }
});

// Alias por si en algún lado quedó con guion bajo
router.get("/mis_reservas", (_req, res) => res.redirect("/mis-rentas"));

/* =========================
   REPROGRAMAR - GET
   ========================= */
router.get("/reservas/:id/editar", ensureLogged, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;

  try {
    // Reserva y auto
    const [[reserva]] = await pool.query(
      `
      SELECT r.id, r.car_id, r.start_date, r.end_date, r.status,
             c.brand, c.model, c.price_per_day, COALESCE(c.image_url,'') AS image_url
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      WHERE r.id = ? AND r.user_id = ?
      `,
      [id, userId]
    );
    if (!reserva) return res.status(404).send("Reserva no encontrada.");

    // Otras reservas del MISMO auto para bloquear fechas (excluye la actual)
    const [booked] = await pool.query(
      `
      SELECT start_date, end_date
      FROM reservations
      WHERE car_id = ?
        AND id <> ?
        AND status <> 'cancelled'
      `,
      [reserva.car_id, reserva.id]
    );

    return res.render("edit_reservation", {
      car: {
        image_url: reserva.image_url,
        brand: reserva.brand,
        model: reserva.model,
        price_per_day: reserva.price_per_day,
      },
      reserva: {
        id: reserva.id,
        start_date: reserva.start_date,
        end_date: reserva.end_date,
        status: reserva.status,
      },
      reservations: booked, // para bloquear en flatpickr
      errors: [],
    });
  } catch (err) {
    console.error("GET /reservas/:id/editar error:", err);
    return res.status(500).send("No se pudo cargar la reprogramación.");
  }
});

/* =========================
   REPROGRAMAR - POST
   ========================= */
router.post("/reservas/:id/editar", ensureLogged, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  const { dateRange } = req.body;

  try {
    const [[reserva]] = await pool.query(
      `
      SELECT r.id, r.car_id, r.start_date, r.end_date, r.status,
             c.brand, c.model, c.price_per_day, COALESCE(c.image_url,'') AS image_url
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      WHERE r.id = ? AND r.user_id = ?
      `,
      [id, userId]
    );
    if (!reserva) return res.status(404).send("Reserva no encontrada.");

    const [new_start, new_end] = parseRange(dateRange);
    const errors = [];
    if (!new_start || !new_end) errors.push("Selecciona un rango de fechas válido.");

    // Conflictos con otras reservas del mismo auto
    const [conflicts] = await pool.query(
      `
      SELECT id
      FROM reservations
      WHERE car_id = ?
        AND id <> ?
        AND status <> 'cancelled'
        AND NOT (end_date <= ? OR start_date >= ?)
      `,
      [reserva.car_id, reserva.id, new_start, new_end]
    );
    if (conflicts.length > 0) errors.push("Las fechas seleccionadas chocan con otra reserva.");

    if (errors.length > 0) {
      const [booked] = await pool.query(
        `
        SELECT start_date, end_date
        FROM reservations
        WHERE car_id = ?
          AND id <> ?
          AND status <> 'cancelled'
        `,
        [reserva.car_id, reserva.id]
      );

      return res.render("edit_reservation", {
        car: {
          image_url: reserva.image_url,
          brand: reserva.brand,
          model: reserva.model,
          price_per_day: reserva.price_per_day,
        },
        reserva: {
          id: reserva.id,
          start_date: reserva.start_date,
          end_date: reserva.end_date,
          status: reserva.status,
        },
        reservations: booked,
        errors,
      });
    }

    // Cálculo de días y diferencias
    const [[{ oldDays }]] = await pool.query(
      `SELECT GREATEST(DATEDIFF(?, ?), 0) AS oldDays`,
      [reserva.end_date, reserva.start_date]
    );
    const [[{ newDays }]] = await pool.query(
      `SELECT GREATEST(DATEDIFF(?, ?), 0) AS newDays`,
      [new_end, new_start]
    );

    const price = Number(reserva.price_per_day || 0);
    const oldTotal = oldDays * price;
    const newTotal = newDays * price;

    if (newDays > oldDays) {
      // Más días: mandar a pagar diferencia
      const extraAmount = newTotal - oldTotal;
      return res.redirect(
        `/reservas/${reserva.id}/pagar_diferencia?new_start=${encodeURIComponent(
          new_start
        )}&new_end=${encodeURIComponent(new_end)}&extra=${extraAmount}`
      );
    } else {
      // Igual o menos días: actualizar directo y mostrar overlay de reembolso
      const refund = Math.max(oldTotal - newTotal, 0);

      await pool.query(
        `UPDATE reservations SET start_date = ?, end_date = ?, total_amount = ? WHERE id = ?`,
        [new_start, new_end, newTotal, reserva.id]
      );

      return res.redirect(
        `/mis-rentas?refund=1&amount=${refund}&menos=${Math.max(
          oldDays - newDays,
          0
        )}`
      );
    }
  } catch (err) {
    console.error("POST /reservas/:id/editar error:", err);
    return res.status(500).send("No se pudo reprogramar la reserva.");
  }
});

/* =========================
   PAGAR DIFERENCIA - GET
   ========================= */
router.get("/reservas/:id/pagar_diferencia", ensureLogged, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  const { new_start, new_end, extra } = req.query;

  try {
    const [[row]] = await pool.query(
      `
      SELECT r.id, r.car_id, c.brand, c.model, c.price_per_day, COALESCE(c.image_url,'') AS image_url
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      WHERE r.id = ? AND r.user_id = ?
      `,
      [id, userId]
    );
    if (!row) return res.status(404).send("Reserva no encontrada.");

    const [[{ oldDays }]] = await pool.query(
      `SELECT GREATEST(DATEDIFF(r.end_date, r.start_date), 0) AS oldDays
         FROM reservations r WHERE r.id = ?`,
      [id]
    );
    const [[{ newDays }]] = await pool.query(
      `SELECT GREATEST(DATEDIFF(?, ?), 0) AS newDays`,
      [new_end, new_start]
    );

    return res.render("pay_difference", {
      car: { image_url: row.image_url, brand: row.brand, model: row.model },
      pricePerDay: row.price_per_day,
      oldDays,
      newDays,
      extraAmount: Number(extra || 0),
      reservaId: id,
      new_start,
      new_end,
      error: null,
    });
  } catch (err) {
    console.error("GET /reservas/:id/pagar_diferencia error:", err);
    return res.status(500).send("No se pudo cargar el pago de diferencia.");
  }
});

/* =========================
   PAGAR DIFERENCIA - POST
   ========================= */
router.post("/reservas/:id/pagar_diferencia", ensureLogged, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  const { new_start, new_end, extraAmount } = req.body;

  try {
    // (Aquí iría la pasarela real). Simulamos OK y actualizamos.
    const [[row]] = await pool.query(
      `
      SELECT c.price_per_day
      FROM reservations r
      JOIN cars c ON c.id = r.car_id
      WHERE r.id = ? AND r.user_id = ?
      `,
      [id, userId]
    );
    if (!row) return res.status(404).send("Reserva no encontrada.");

    const [[{ newDays }]] = await pool.query(
      `SELECT GREATEST(DATEDIFF(?, ?), 0) AS newDays`,
      [new_end, new_start]
    );
    const newTotal = newDays * Number(row.price_per_day || 0);

    await pool.query(
      `UPDATE reservations
         SET start_date = ?, end_date = ?, total_amount = ?
       WHERE id = ?`,
      [new_start, new_end, newTotal, id]
    );

    // dispara el overlay de éxito en la lista
    return res.redirect("/mis-rentas?paid=1");
  } catch (err) {
    console.error("POST /reservas/:id/pagar_diferencia error:", err);
    return res.status(500).send("No se pudo procesar el pago de diferencia.");
  }
});

/* =========================
   CANCELAR
   ========================= */
router.post("/reservas/:id/cancel", ensureLogged, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;

  try {
    const [[current]] = await pool.query(
      `SELECT id, status FROM reservations WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!current) return res.status(404).send("Reserva no encontrada.");
    if (current.status === "cancelled") return res.redirect("/mis-rentas");

    await pool.query(
      `UPDATE reservations SET status = 'cancelled' WHERE id = ?`,
      [id]
    );

    // Si manejas reembolso aquí, puedes agregar ?refund=1&amount=...
    return res.redirect("/mis-rentas");
  } catch (err) {
    console.error("POST /reservas/:id/cancel error:", err);
    return res.status(500).send("No se pudo cancelar la reserva.");
  }
});

export default router;
