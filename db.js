import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: "127.0.0.1",
  user: "car_user",
  password: "car_pass_123",
  database: "car_agency",
});


export default pool;
