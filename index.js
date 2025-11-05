import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

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
    secret: "super-secreto", // cámbialo
    resave: false,
    saveUninitialized: false,
  })
);

// 3) "Base de datos" temporal
const users = [
  {
    id: 1,
    email: "admin@agency.com",
    password: "123456",
    role: "admin",
  },
  {
    id: 2,
    email: "cliente@agency.com",
    password: "123456",
    role: "user",
  },
];

// 4) Hacer disponible el usuario en las vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// 5) Rutas

// Home
app.get("/", (req, res) => {
  res.render("index");
});

// Form de login
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// Procesar login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = users.find(
    (u) => u.email === email && u.password === password
  );

  if (!user) {
    return res.status(401).render("login", { error: "Credenciales inválidas" });
  }

  // guardar en sesión
  req.session.user = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  // redirigir según rol
  if (user.role === "admin") {
    return res.redirect("/admin");
  } else {
    return res.redirect("/");
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
