// routes/autos.js
import { Router } from "express";
import pool from "../db.js";
import multer from "multer";
import path from "path";

const router = Router();

// middleware admin
function ensureAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("No tienes permiso");
  }
  next();
}

// configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads"); // asegúrate de que exista
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

/**
 * GET formulario
 * Ruta final: /admin/autos/nuevo
 */
router.get("/admin/autos/nuevo", ensureAdmin, (req, res) => {
  res.render("admin/new-car", {
    error: null,
  });
});

/**
 * POST crear auto
 * Ruta final: /admin/autos/nuevo
 */
router.post(
  "/admin/autos/nuevo",
  ensureAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        brand,
        model,
        year,
        price_per_day,
        body_type,
        seats,
        image_url,
      } = req.body;

      const errors = [];

      // campos obligatorios
      if (!brand || !brand.trim()) errors.push("La marca es obligatoria.");
      if (!model || !model.trim()) errors.push("El modelo es obligatorio.");
      if (!year) errors.push("El año es obligatorio.");
      if (!price_per_day) errors.push("El precio por día es obligatorio.");

      // año válido
      const y = Number(year);
      if (isNaN(y) || y < 1980 || y > 2026) {
        errors.push("El año debe estar entre 1980 y 2026.");
      }

      // precio válido
      const price = Number(price_per_day);
      if (isNaN(price) || price <= 0) {
        errors.push("El precio debe ser un número mayor a 0.");
      }

      // seats opcional, pero si viene que sea entero
      let seatsVal = null;
      if (seats && seats !== "") {
        const s = Number(seats);
        if (isNaN(s) || s <= 0) {
          errors.push("Los asientos deben ser un número entero positivo.");
        } else {
          seatsVal = s;
        }
      }

      // si hay errores, volvemos a mostrar el form
      if (errors.length > 0) {
        return res.status(400).render("admin/new-car", {
          error: errors.join(" "),
        });
      }

      // imagen final
      const finalImage =
        req.file ? "/uploads/" + req.file.filename : image_url || null;

      await pool.query(
        `
        INSERT INTO cars
          (brand, model, year, price_per_day, status, image_url, body_type, seats, created_at)
        VALUES (?, ?, ?, ?, 'available', ?, ?, ?, NOW())
        `,
        [
          brand.trim(),
          model.trim(),
          y,
          price,
          finalImage,
          body_type || null,
          seatsVal,
        ]
      );

      return res.redirect("/catalogo");
    } catch (err) {
      console.error("Error creando auto:", err);
      return res.status(500).render("admin/new-car", {
        error: "Ocurrió un error al guardar el auto.",
      });
    }
  }
);


export default router;
