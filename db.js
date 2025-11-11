// db.js
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: "mainline.proxy.rlwy.net",
  port: 21086,
  user: "root",
  password: "oXDdzSBPfQRZPhuTnuBlBxoLJondAOBb",
  database: "railway",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false
  }
});

export default pool;
