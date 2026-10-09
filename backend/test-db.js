
const pool = require("./db");

async function testConnection() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        NOW() AS server_time
    `);

    console.log("¡Conexión con Neon exitosa!");
    console.log("Base de datos:", result.rows[0].database);
    console.log("Hora del servidor:", result.rows[0].server_time);
  } catch (error) {
    console.error("No se pudo conectar con Neon:");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testConnection();