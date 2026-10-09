
const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

// Carga el .env ubicado en la raíz del proyecto.
dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

if (!process.env.DATABASE_URL) {
  throw new Error("Falta configurar DATABASE_URL en el archivo .env");
}

// Pool administra las conexiones a PostgreSQL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Registra los errores de conexiones inactivas.
pool.on("error", (error) => {
  console.error("Error inesperado en PostgreSQL:", error.message);
});

module.exports = pool;