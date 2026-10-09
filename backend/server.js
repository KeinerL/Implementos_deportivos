const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} = require("node:crypto");

const scryptAsync = promisify(scrypt);
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(__dirname, "data.json");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const sessions = new Map();
let store;
let saveQueue = Promise.resolve();

function createEmptyStore() {
  return { users: [], categories: [], items: [] };
}

async function loadStore() {
  try {
    const contents = await fs.promises.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(contents);
    if (
      !parsed ||
      !Array.isArray(parsed.users) ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.items)
    ) {
      throw new Error("El archivo de datos no tiene el formato esperado.");
    }
    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const emptyStore = createEmptyStore();
    await fs.promises.writeFile(DATA_FILE, JSON.stringify(emptyStore, null, 2));
    return emptyStore;
  }
}

function saveStore() {
  const snapshot = JSON.stringify(store, null, 2);
  const persist = async () => {
    const temporaryFile = `${DATA_FILE}.tmp`;
    await fs.promises.writeFile(temporaryFile, snapshot, "utf8");
    await fs.promises.rename(temporaryFile, DATA_FILE);
  };
  saveQueue = saveQueue.then(persist, persist);
  return saveQueue;
}

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true"
    ? "; Secure"
    : "";
  response.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`,
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
}

function getSession(request) {
  const cookieHeader = request.headers.cookie || "";
  const token = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("session="))
    ?.slice("session=".length);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireSession(request, response) {
  const session = getSession(request);
  if (!session) {
    sendJson(response, 401, { error: "Inicia sesión para continuar." });
    return null;
  }
  return session;
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function readJson(request) {
  if (!request.headers["content-type"]?.includes("application/json")) {
    const error = new Error("El contenido debe enviarse como JSON.");
    error.statusCode = 415;
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("La solicitud es demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("El JSON enviado no es válido.");
    error.statusCode = 400;
    throw error;
  }
}

function cleanText(value, maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeUser(user) {
  return {
    username: user.username,
    role: user.role === "admin" || user.role === "staff"
      ? user.role
      : user.role == null ? "admin" : "staff",
  };
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derivedKey = await scryptAsync(password, salt, 64);
  return { salt, hash: derivedKey.toString("hex") };
}

async function verifyPassword(password, user) {
  const candidate = await scryptAsync(password, user.salt, 64);
  const stored = Buffer.from(user.hash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function publicItem(item) {
  const { id, name, code, categoryId, status, loan } = item;
  return { id, name, code, categoryId, status, loan };
}

function sendFile(response, relativePath, contentType) {
  const absolutePath = path.join(ROOT, relativePath);
  fs.readFile(absolutePath, (error, contents) => {
    if (error) {
      sendJson(response, 500, { error: "No se pudo cargar la página." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    response.end(contents);
  });
}

async function handleApi(request, response, pathname) {
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: "Origen de solicitud no permitido." });
    return;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    const session = getSession(request);
    const user = session && store.users.find((entry) => entry.username === session.username);
    sendJson(response, 200, {
      setupRequired: store.users.length === 0,
      user: user ? safeUser(user) : null,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/setup") {
    if (store.users.length > 0) {
      sendJson(response, 409, { error: "La configuración inicial ya se completó." });
      return;
    }
    const body = await readJson(request);
    const username = cleanText(body.username, 40);
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)) {
      sendJson(response, 400, {
        error: "El usuario debe tener entre 3 y 40 letras, números, puntos, guiones o guiones bajos.",
      });
      return;
    }
    if (password.length < 10 || password.length > 200) {
      sendJson(response, 400, { error: "La contraseña debe tener entre 10 y 200 caracteres." });
      return;
    }
    const credentials = await hashPassword(password);
    if (store.users.length > 0) {
      sendJson(response, 409, { error: "La configuración inicial ya se completó." });
      return;
    }
    store.users.push({ username, role: "admin", ...credentials });
    await saveStore();
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(response, token);
    sendJson(response, 201, { user: { username } });
    return;
  }

  if (request.method === "POST" && pathname === "/api/login") {
    const body = await readJson(request);
    const username = cleanText(body.username, 40);
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length > 200) {
      sendJson(response, 401, { error: "Usuario o contraseña incorrectos." });
      return;
    }
    const user = store.users.find(
      (entry) => entry.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
    );
    const passwordMatches = user
      ? await verifyPassword(password, user)
      : await scryptAsync(password || "invalid-password", "invalid-salt", 64).then(() => false);
    if (!user || !passwordMatches) {
      sendJson(response, 401, { error: "Usuario o contraseña incorrectos." });
      return;
    }
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { username: user.username, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(response, token);
    sendJson(response, 200, { user: safeUser(user) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/logout") {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  const session = requireSession(request, response);
  if (!session) return;
  const currentUser = store.users.find((user) => user.username === session.username);
  if (!currentUser) {
    sendJson(response, 401, { error: "La sesión ya no es válida. Inicia sesión de nuevo." });
    return;
  }
  const isAdmin = safeUser(currentUser).role === "admin";

  if (request.method === "GET" && pathname === "/api/data") {
    sendJson(response, 200, {
      user: safeUser(currentUser),
      categories: store.categories,
      items: store.items.map(publicItem),
      users: isAdmin ? store.users.map(safeUser) : [],
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/users") {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede gestionar usuarios." });
      return;
    }
    const body = await readJson(request);
    const username = cleanText(body.username, 40);
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;
    if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)) {
      sendJson(response, 400, {
        error: "El usuario debe tener entre 3 y 40 letras, números, puntos, guiones o guiones bajos.",
      });
      return;
    }
    if (password.length < 10 || password.length > 200) {
      sendJson(response, 400, { error: "La contraseña debe tener entre 10 y 200 caracteres." });
      return;
    }
    if (role !== "admin" && role !== "staff") {
      sendJson(response, 400, { error: "Selecciona un rol válido." });
      return;
    }
    if (store.users.some((user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
      sendJson(response, 409, { error: "Ya existe un usuario con ese nombre." });
      return;
    }
    const credentials = await hashPassword(password);
    const user = { username, role, ...credentials };
    store.users.push(user);
    await saveStore();
    sendJson(response, 201, { user: safeUser(user) });
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/users") {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede gestionar usuarios." });
      return;
    }
    const body = await readJson(request);
    const username = cleanText(body.username, 40);
    if (username.toLocaleLowerCase() === currentUser.username.toLocaleLowerCase()) {
      sendJson(response, 409, { error: "No puedes eliminar tu propia cuenta." });
      return;
    }
    const user = store.users.find(
      (entry) => entry.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
    );
    if (!user) {
      sendJson(response, 404, { error: "No se encontró el usuario." });
      return;
    }
    store.users = store.users.filter((entry) => entry !== user);
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/categories") {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede gestionar categorías." });
      return;
    }
    const body = await readJson(request);
    const name = cleanText(body.name, 60);
    if (!name) {
      sendJson(response, 400, { error: "Escribe el nombre de la categoría." });
      return;
    }
    if (store.categories.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      sendJson(response, 409, { error: "Ya existe una categoría con ese nombre." });
      return;
    }
    const category = { id: randomUUID(), name };
    store.categories.push(category);
    await saveStore();
    sendJson(response, 201, { category });
    return;
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && categoryMatch) {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede gestionar categorías." });
      return;
    }
    const category = store.categories.find((entry) => entry.id === categoryMatch[1]);
    if (!category) {
      sendJson(response, 404, { error: "No se encontró la categoría." });
      return;
    }
    if (store.items.some((item) => item.categoryId === category.id)) {
      sendJson(response, 409, { error: "Primero cambia o elimina los implementos de esta categoría." });
      return;
    }
    store.categories = store.categories.filter((entry) => entry.id !== category.id);
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/items") {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede agregar implementos." });
      return;
    }
    const body = await readJson(request);
    const name = cleanText(body.name, 100);
    const code = cleanText(body.code, 50);
    const category = store.categories.find((entry) => entry.id === body.categoryId);
    if (!name || !category) {
      sendJson(response, 400, { error: "Indica el nombre del implemento y una categoría válida." });
      return;
    }
    if (code && store.items.some((item) => item.code.toLocaleLowerCase() === code.toLocaleLowerCase())) {
      sendJson(response, 409, { error: "Ya existe un implemento con ese código." });
      return;
    }
    const item = {
      id: randomUUID(),
      name,
      code,
      categoryId: category.id,
      status: "available",
      loan: null,
    };
    store.items.push(item);
    await saveStore();
    sendJson(response, 201, { item: publicItem(item) });
    return;
  }

  const itemMatch = pathname.match(/^\/api\/items\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && itemMatch) {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede eliminar implementos." });
      return;
    }
    const item = store.items.find((entry) => entry.id === itemMatch[1]);
    if (!item) {
      sendJson(response, 404, { error: "No se encontró el implemento." });
      return;
    }
    if (item.status === "borrowed") {
      sendJson(response, 409, { error: "Registra la devolución antes de eliminar este implemento." });
      return;
    }
    store.items = store.items.filter((entry) => entry.id !== item.id);
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  const itemActionMatch = pathname.match(/^\/api\/items\/([0-9a-f-]+)\/(checkout|return|status)$/i);
  if (request.method === "PATCH" && itemActionMatch) {
    const item = store.items.find((entry) => entry.id === itemActionMatch[1]);
    if (!item) {
      sendJson(response, 404, { error: "No se encontró el implemento." });
      return;
    }
    const action = itemActionMatch[2];
    if (action === "status" && !isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede cambiar el estado del inventario." });
      return;
    }
    const body = await readJson(request);

    if (action === "checkout") {
      const person = cleanText(body.person, 100);
      const reason = cleanText(body.reason, 240);
      if (item.status !== "available") {
        sendJson(response, 409, { error: "Este implemento no está disponible para préstamo." });
        return;
      }
      if (!person || !reason) {
        sendJson(response, 400, { error: "Indica quién recibe el implemento y el motivo del préstamo." });
        return;
      }
      item.status = "borrowed";
      item.loan = {
        person,
        reason,
        checkedOutAt: new Date().toISOString(),
        checkedOutBy: session.username,
      };
    } else if (action === "return") {
      if (item.status !== "borrowed") {
        sendJson(response, 409, { error: "El implemento no figura como prestado." });
        return;
      }
      item.status = "available";
      item.loan = null;
    } else {
      const status = body.status;
      if (!["available", "maintenance", "lost"].includes(status)) {
        sendJson(response, 400, { error: "El estado indicado no es válido." });
        return;
      }
      if (item.status === "borrowed" && status !== "lost") {
        sendJson(response, 409, { error: "Registra la devolución antes de cambiar el estado." });
        return;
      }
      item.status = status;
      if (status !== "lost") item.loan = null;
    }

    await saveStore();
    sendJson(response, 200, { item: publicItem(item) });
    return;
  }

  sendJson(response, 404, { error: "No se encontró esta ruta." });
}

function handleRequest(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;

  if (pathname.startsWith("/api/")) {
    handleApi(request, response, pathname).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (!error.statusCode) console.error("Error al procesar la solicitud:", error);
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Ocurrió un error interno.",
      });
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Método no permitido." });
    return;
  }
  const files = {
    "/": ["frontend/index.html", "text/html; charset=utf-8"],
    "/styles.css": ["frontend/styles.css", "text/css; charset=utf-8"],
    "/app.js": ["frontend/app.js", "text/javascript; charset=utf-8"],
  };
  const file = files[pathname];
  if (!file) {
    sendJson(response, 404, { error: "No se encontró esta página." });
    return;
  }
  sendFile(response, file[0], file[1]);
}

async function start() {
  store = await loadStore();
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`Gestor de implementos disponible en http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar el servidor:", error);
  process.exitCode = 1;
});
