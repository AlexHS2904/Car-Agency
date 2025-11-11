// index.js
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import pool from "./db.js";
import adminRoutes from "./routes/admin.js";
import reservationsRoutes from "./routes/reservations.js";

const app = express();

// __dirname en ESModules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) EJS
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));

// 2) Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

app.use(
  session({
    secret: "super-secreto",
    resave: false,
    saveUninitialized: false,
  })
);

// 3) Usuario disponible en las vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// --- helpers de seguridad ---
function ensureLogged(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function ensureAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("No tienes permiso");
  }
  next();
}

// 4) Rutas de admin (protegidas)
app.use("/admin", ensureAdmin, adminRoutes);

// 4.1) Rutas de reservas
app.use("/", reservationsRoutes);

// 5) Rutas principales

// Home
app.get("/", async (req, res) => {
  try {
    const [miniCars] = await pool.query(
      `SELECT id, brand, model, year, price_per_day, image_url
       FROM cars
       WHERE status = 'available'
       ORDER BY RAND()
       LIMIT 13`
    );

    res.render("index", { miniCars });
  } catch (err) {
    console.error("Error cargando mini carrusel:", err);
    res.render("index", { miniCars: [] });
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.password, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.email = ?`,
      [email]
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .render("login", { error: "Usuario o contraseña incorrectos" });
    }

    const user = rows[0];

    // TODO: password hasheado
    if (user.password !== password) {
      return res
        .status(401)
        .render("login", { error: "Usuario o contraseña incorrectos" });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    if (user.role === "admin") {
      return res.redirect("/admin/dashboard");
    } else {
      return res.redirect("/");
    }
  } catch (err) {
    console.error("Error en login:", err);
    return res.status(500).render("login", { error: "Error en el servidor" });
  }
});

// REGISTER
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  const { name, email, phone, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).render("register", {
      error: "Las contraseñas no coinciden",
    });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).render("register", {
        error: "Ya existe una cuenta con ese correo",
      });
    }

    const [result] = await pool.query(
      "INSERT INTO users (name, email, phone, password, role_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, phone || null, password, 2] // 2 = usuario normal
    );

    req.session.user = {
      id: result.insertId,
      email,
      role: "user",
      name,
    };

    return res.redirect("/");
  } catch (err) {
    console.error("Error en register:", err);
    return res.status(500).render("register", {
      error: "Error al registrar. Intenta de nuevo.",
    });
  }
});

// ADMIN directo
app.get("/admin", ensureAdmin, (req, res) => {
  return res.redirect("/admin/dashboard");
});

// CERRAR SESIÓN
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// CATÁLOGO
app.get("/catalogo", async (req, res) => {
  const { year, tipo, max_price } = req.query;

  let query = "SELECT * FROM cars WHERE status = 'available'";
  const params = [];

  if (year && year !== "") {
    query += " AND year = ?";
    params.push(year);
  }

  if (tipo && tipo !== "") {
    query += " AND body_type = ?";
    params.push(tipo);
  }

  if (max_price && max_price !== "") {
    query += " AND price_per_day <= ?";
    params.push(max_price);
  }

  query += " ORDER BY price_per_day ASC";

  try {
    const [cars] = await pool.query(query, params);
    return res.render("catalogo", {
      cars,
      filters: { year, tipo, max_price },
    });
  } catch (err) {
    console.error("Error cargando catálogo:", err);
    return res.render("catalogo", {
      cars: [],
      filters: { year, tipo, max_price },
    });
  }
});

// levantar server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server on " + PORT);
});
