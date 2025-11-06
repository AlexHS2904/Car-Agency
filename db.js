// db.js
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || "car_user",
  password: process.env.DB_PASS || "car_pass_123",
  database: process.env.DB_NAME || "car_agency",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
