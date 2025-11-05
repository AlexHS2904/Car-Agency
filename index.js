import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";

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

// 3) Hacer disponible el usuario en las vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// 4) Rutas

// Home
app.get("/", (req, res) => {
  res.render("index");
});


// Form de login
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// Procesar login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // buscamos al usuario en la BD
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.password, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.email = ?`,
      [email]
    );

    // no existe
    if (rows.length === 0) {
      return res
        .status(401)
        .render("login", { error: "Usuario o contraseña incorrectos" });
    }

    const user = rows[0];

    // contraseña simple
    if (user.password !== password) {
      return res
        .status(401)
        .render("login", { error: "Usuario o contraseña incorrectos" });
    }

    // guardar en sesión
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role, // 'admin' o 'user'
    };

    // redirigir según rol
    if (user.role === "admin") {
      return res.redirect("/admin");
    } else {
      return res.redirect("/");
    }
  } catch (err) {
    console.error("Error en login:", err);
    return res.status(500).render("login", { error: "Error en el servidor" });
  }
});

// Ruta protegida solo admin
app.get("/admin", ensureAdmin, (req, res) => {
  res.render("admin-dashboard");
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server on " + PORT);
});

// Ruta crear usuarios

// GET /register (ya la tienes)
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

// POST /register
app.post("/register", async (req, res) => {
  const { name, email, phone, password, confirmPassword } = req.body;

  // 1. validar contraseñas iguales (por si el usuario se saltó la validación del front)
  if (password !== confirmPassword) {
    return res.status(400).render("register", {
      error: "Las contraseñas no coinciden",
    });
  }

  try {
    // 2. ¿ya existe ese correo?
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).render("register", {
        error: "Ya existe una cuenta con ese correo",
      });
    }

    // 3. insertar usuario nuevo con rol user (2)
    await pool.query(
      "INSERT INTO users (name, email, phone, password, role_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, phone || null, password, 2] // 2 = user
    );

    // 4. después de registrarse, lo mandamos a login
    return res.redirect("/login");
  } catch (err) {
    console.error(err);
    return res.status(500).render("register", {
      error: "Error al registrar. Intenta de nuevo.",
    });
  }
});


// catálogo de autos
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

  // opcional: ordena por precio
  query += " ORDER BY price_per_day ASC";

  const [cars] = await pool.query(query, params);

  res.render("catalogo", {
    cars,
    filters: { year, tipo, max_price },
  });
});
