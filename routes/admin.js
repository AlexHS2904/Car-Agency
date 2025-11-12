// routes/admin.js
import express from "express";
import pool from "../db.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// asegurar carpeta
const UPLOAD_DIR = "public/uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// === MULTER para subir imagen ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// DASHBOARD (dejamos simple para que no truene por otras tablas)
router.get("/dashboard", async (req, res) => {
  try {
    const [[{ publicados }]] = await pool.query(
      "SELECT COUNT(*) AS publicados FROM cars WHERE status = 'available'"
    );

    res.render("admin/dashboard", {
      publicados,
      vendidos: 0,
      reservados: 0,
      ingresos: 0,
      movimientos: [],
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

// GET formulario
router.get("/autos/nuevo", (req, res) => {
  res.render("admin/new-car", { error: null });
});

// POST guardar
router.post(
  "/autos/nuevo",
  upload.single("image_file"),
  async (req, res) => {
    try {
      const {
        title,
        brand,
        model,
        year,
        price_per_day,
        description,
        category,
        image_url,
      } = req.body;

      // prioridad: archivo > url > placeholder
      let finalImage = "/Assets/Imgs/placeholder-car.jpg";

      if (req.file) {
        finalImage = "/uploads/" + req.file.filename;
      } else if (image_url && image_url.trim() !== "") {
        finalImage = image_url.trim();
      }

      // IMPORTANTE: solo columnas que sabemos que tienes
      // (en tu index.js haces SELECT de brand, model, year, price_per_day, image_url)
      await pool.query(
        `INSERT INTO cars 
          (title, brand, model, year, price_per_day, description, category, image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
        [
          title,
          brand,
          model,
          year,
          price_per_day,
          description || null,
          category || null,
          finalImage,
        ]
      );

      res.redirect("/catalogo");
    } catch (err) {
      console.error("Error creando auto:", err); // 👈 mira esto en la consola
      res.status(500).render("admin/new-car", {
        error: "Ocurrió un error al guardar el auto. Revisa la consola del servidor.",
      });
    }
  }
);

export default router;
