require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function testConnection() {
  try {
    const result = await pool.query(
      "SELECT current_user, current_database(), NOW()"
    );

    console.log("✅ PostgreSQL connected successfully");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("❌ PostgreSQL connection failed:");
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  testConnection();
}

module.exports = {
  pool,
};