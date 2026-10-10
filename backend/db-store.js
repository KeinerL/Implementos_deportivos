
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

    // 1. Insertar o actualizar categorías.
    for (const category of store.categories) {
      await client.query(
        `INSERT INTO categories (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name`,
        [category.id, category.name]
      );
    }

    // 2. Insertar o actualizar usuarios.
    for (const user of store.users) {
      await client.query(
        `INSERT INTO users (username, role, salt, hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE
         SET role = EXCLUDED.role,
             salt = EXCLUDED.salt,
             hash = EXCLUDED.hash`,
        [user.username, user.role, user.salt, user.hash]
      );
    }

    // 3. Insertar o actualizar implementos.
    for (const item of store.items) {
      await client.query(
        `INSERT INTO items
          (id, name, code, category_id, status, loan, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             code = EXCLUDED.code,
             category_id = EXCLUDED.category_id,
             status = EXCLUDED.status,
             loan = EXCLUDED.loan,
             image_url = EXCLUDED.image_url`,
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

    // 4. Eliminar solo implementos que ya no existen.
    await client.query(
      `DELETE FROM items
       WHERE NOT (id = ANY($1::uuid[]))`,
      [store.items.map((item) => item.id)]
    );

    // 5. Eliminar solo categorías que ya no existen.
    await client.query(
      `DELETE FROM categories
       WHERE NOT (id = ANY($1::uuid[]))`,
      [store.categories.map((category) => category.id)]
    );

    // 6. Eliminar solo usuarios que ya no existen.
    await client.query(
      `DELETE FROM users
       WHERE NOT (username = ANY($1::text[]))`,
      [store.users.map((user) => user.username)]
    );

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