// routes/autos.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

// LISTAR autos (vista de inventario para admin o pública)
router.get("/autos", async (req, res) => {
  try {
    const [cars] = await pool.query(
      "SELECT * FROM cars ORDER BY created_at DESC"
    );

    // si ya tienes una vista específica, cámbiale el nombre
    res.render("autos", { cars });
  } catch (err) {
    console.error("Error listando autos:", err);
    res.render("autos", { cars: [] });
  }
});

// (opcional) detalle de un auto
router.get("/autos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [[car]] = await pool.query("SELECT * FROM cars WHERE id = ?", [id]);
    if (!car) {
      return res.status(404).send("Auto no encontrado");
    }
    res.render("auto-detalle", { car });
  } catch (err) {
    console.error("Error cargando auto:", err);
    res.status(500).send("Error en el servidor");
  }
});

export default router;
