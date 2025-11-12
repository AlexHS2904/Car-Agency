// routes/autos.js
import { Router } from "express";
import pool from "../db.js";
import multer from "multer";
import path from "path";

const router = Router();

function ensureAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("No tienes permiso");
  }
  next();
}

// Subidas con Multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "public/uploads"),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

/* =========================
   INVENTARIO
   ========================= */
// /autos (lista) – lo dejamos por compatibilidad
router.get("/autos", ensureAdmin, async (req, res) => {
  const { q } = req.query;
  let sql = `
    SELECT
      c.id, c.brand, c.model, c.year, c.price_per_day,
      COALESCE(c.image_url,'') AS image_url,
      COALESCE(c.status,'available') AS status,
      c.created_at,
      (SELECT COUNT(*) FROM reservations r WHERE r.car_id = c.id) AS reservas_total
    FROM cars c
    WHERE 1=1
  `;
  const params = [];
  if (q && q.trim() !== "") {
    sql += ` AND (c.brand LIKE ? OR c.model LIKE ? OR c.body_type LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY c.id DESC`;

  try {
    const [cars] = await pool.query(sql, params);
    return res.render("admin/inventory", { cars, q: q || "" });
  } catch (err) {
    console.error("GET /autos error:", err);
    return res.status(500).send("Error cargando inventario.");
  }
});

// /admin/autos (lista) – ruta espejo bajo /admin
router.get("/admin/autos", ensureAdmin, async (req, res) => {
  req.url = "/autos" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return router.handle(req, res);
});

/* =========================
   NUEVO
   ========================= */
router.get("/admin/autos/nuevo", ensureAdmin, (_req, res) => {
  res.render("admin/new-car", { error: null, preset: null });
});

router.post(
  "/admin/autos/nuevo",
  ensureAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        brand, model, year, price_per_day,
        body_type, seats, image_url, description
      } = req.body;

      const errors = [];
      if (!brand || !brand.trim()) errors.push("La marca es obligatoria.");
      if (!model || !model.trim()) errors.push("El modelo es obligatorio.");
      if (!year) errors.push("El año es obligatorio.");
      if (!price_per_day) errors.push("El precio por día es obligatorio.");

      const y = Number(year);
      if (isNaN(y) || y < 1980 || y > 2026) errors.push("El año debe estar entre 1980 y 2026.");

      const price = Number(price_per_day);
      if (isNaN(price) || price <= 0) errors.push("El precio debe ser un número mayor a 0.");

      let seatsVal = null;
      if (seats && seats !== "") {
        const s = Number(seats);
        if (isNaN(s) || s <= 0) errors.push("Los asientos deben ser un número entero positivo.");
        else seatsVal = s;
      }

      if (errors.length > 0) {
        return res.status(400).render("admin/new-car", {
          error: errors.join(" "),
          preset: {
            brand, model, year, price_per_day,
            body_type, seats: seatsVal, image_url, description
          },
        });
      }

      const finalImage =
        req.file ? "/uploads/" + req.file.filename : image_url || null;

      await pool.query(
        `
        INSERT INTO cars
          (brand, model, year, price_per_day, status, image_url, body_type, seats, description, created_at)
        VALUES (?, ?, ?, ?, 'available', ?, ?, ?, ?, NOW())
        `,
        [
          brand.trim(),
          model.trim(),
          y,
          price,
          finalImage,
          body_type || null,
          seatsVal,
          description || null,
        ]
      );

      return res.redirect("/autos");
    } catch (err) {
      console.error("POST /admin/autos/nuevo error:", err);
      return res.status(500).render("admin/new-car", {
        error: "Ocurrió un error al guardar el auto.",
        preset: null,
      });
    }
  }
);

/* =========================
   EDITAR
   ========================= */
// Preferimos URL bajo /admin para claridad en el panel
router.get("/admin/autos/:id/editar", ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [[car]] = await pool.query(
      `
      SELECT
        c.id, c.brand, c.model, c.year, c.price_per_day,
        COALESCE(c.image_url,'') AS image_url,
        COALESCE(c.status,'available') AS status,
        c.body_type, c.seats, c.description
      FROM cars c
      WHERE c.id = ?
      `,
      [id]
    );
    if (!car) return res.status(404).send("Auto no encontrado.");

    return res.render("admin/car_edit", { car, error: null });
  } catch (err) {
    console.error("GET /admin/autos/:id/editar error:", err);
    return res.status(500).send("Error cargando el auto.");
  }
});

router.post(
  "/admin/autos/:id/editar",
  ensureAdmin,
  upload.single("image"),
  async (req, res) => {
    const { id } = req.params;
    try {
      const {
        brand, model, year, price_per_day,
        body_type, seats, image_url, description, status
      } = req.body;

      const errors = [];
      if (!brand || !brand.trim()) errors.push("La marca es obligatoria.");
      if (!model || !model.trim()) errors.push("El modelo es obligatorio.");
      if (!year) errors.push("El año es obligatorio.");
      if (!price_per_day) errors.push("El precio por día es obligatorio.");

      const y = Number(year);
      if (isNaN(y) || y < 1980 || y > 2026) errors.push("El año debe estar entre 1980 y 2026.");

      const price = Number(price_per_day);
      if (isNaN(price) || price <= 0) errors.push("El precio debe ser un número mayor a 0.");

      let seatsVal = null;
      if (seats && seats !== "") {
        const s = Number(seats);
        if (isNaN(s) || s <= 0) errors.push("Los asientos deben ser un número entero positivo.");
        else seatsVal = s;
      }

      if (errors.length > 0) {
        const [[car]] = await pool.query(`SELECT * FROM cars WHERE id = ?`, [id]);
        if (!car) return res.status(404).send("Auto no encontrado.");
        return res.status(400).render("admin/car_edit", {
          car: { ...car, image_url: car.image_url || "" },
          error: errors.join(" "),
        });
      }

      let finalImage = null;
      if (req.file) finalImage = "/uploads/" + req.file.filename;
      else if (typeof image_url === "string") finalImage = image_url.trim() || null;

      const fields = [
        brand.trim(),
        model.trim(),
        y,
        price,
        body_type || null,
        seatsVal,
        description || null,
        status || "available",
      ];
      let setImageSQL = "";
      if (finalImage !== null) {
        setImageSQL = ", image_url = ? ";
        fields.push(finalImage);
      }
      fields.push(id);

      await pool.query(
        `
        UPDATE cars
        SET brand = ?, model = ?, year = ?, price_per_day = ?,
            body_type = ?, seats = ?, description = ?, status = ?
            ${setImageSQL}
        WHERE id = ?
        `,
        fields
      );

      return res.redirect("/autos");
    } catch (err) {
      console.error("POST /admin/autos/:id/editar error:", err);
      return res.status(500).send("No se pudo actualizar el auto.");
    }
  }
);

//Rutas “legacy” por si aún hay enlaces viejos sin /admin
router.get("/autos/:id/editar", ensureAdmin, (req, res) =>
  res.redirect(`/admin/autos/${req.params.id}/editar`)
);
router.post("/autos/:id/editar", ensureAdmin, (req, res) =>
  res.redirect(307, `/admin/autos/${req.params.id}/editar`)
);

export default router;
