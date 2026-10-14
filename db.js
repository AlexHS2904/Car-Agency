import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

function convertPlaceholders(sql) {
  let index = 0;

  return sql.replace(/\?/g, () => {
    index++;
    return `$${index}`;
  });
}

const pool = {
  async query(sql, params = []) {
    const postgresSQL = convertPlaceholders(sql);

    const result = await pgPool.query(postgresSQL, params);

    if (/^\s*INSERT/i.test(sql)) {
      return [
        {
          insertId: result.rows[0]?.id,
          affectedRows: result.rowCount,
        },
        result.fields,
      ];
    }

    if (/^\s*(UPDATE|DELETE)/i.test(sql)) {
      return [
        {
          affectedRows: result.rowCount,
        },
        result.fields,
      ];
    }

    return [result.rows, result.fields];
  },

  async end() {
    return pgPool.end();
  },
};

export default pool;