
const pool = require("./db");

async function loadStoreFromDatabase() {
  const [usersResult, categoriesResult, itemsResult] =
    await Promise.all([
      pool.query(
        "SELECT username, role, salt, hash FROM users ORDER BY username"
      ),
      pool.query(
        "SELECT id, name FROM categories ORDER BY name"
      ),
      pool.query(`
        SELECT id, name, code, category_id, status, loan, image_url
        FROM items
        ORDER BY name
      `),
    ]);

  return {
    users: usersResult.rows,
    categories: categoriesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
    })),
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      categoryId: row.category_id,
      status: row.status,
      loan: row.loan,
      ...(row.image_url ? { image: row.image_url } : {}),
    })),
  };
}

async function saveStoreToDatabase(store) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Borramos primero los registros dependientes.
    await client.query("DELETE FROM items");
    await client.query("DELETE FROM categories");
    await client.query("DELETE FROM users");

    for (const user of store.users) {
      await client.query(
        `INSERT INTO users (username, role, salt, hash)
         VALUES ($1, $2, $3, $4)`,
        [user.username, user.role, user.salt, user.hash]
      );
    }

    for (const category of store.categories) {
      await client.query(
        `INSERT INTO categories (id, name)
         VALUES ($1, $2)`,
        [category.id, category.name]
      );
    }

    for (const item of store.items) {
      await client.query(
        `INSERT INTO items
          (id, name, code, category_id, status, loan, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          item.id,
          item.name,
          item.code || "",
          item.categoryId,
          item.status,
          item.loan == null ? null : JSON.stringify(item.loan),
          item.image || null,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  loadStoreFromDatabase,
  saveStoreToDatabase,
};