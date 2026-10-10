const {
  loadStoreFromDatabase,
  saveStoreToDatabase,
} = require("./db-store");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
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
const IMAGE_DIR = path.join(__dirname, "uploads");
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64 * 1024;
const sessions = new Map();
let store;
let saveQueue = Promise.resolve();

function createEmptyStore() {
  return { users: [], categories: [], items: [] };
}

async function loadStore() {
  return loadStoreFromDatabase();
}

function saveStore() {
  const snapshot = JSON.parse(JSON.stringify(store));

  const persist = () => saveStoreToDatabase(snapshot);

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

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!request.headers["content-type"]?.includes("application/json")) {
    const error = new Error("El contenido debe enviarse como JSON.");
    error.statusCode = 415;
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
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

function resolveRequester(body, session, isAdmin) {
  const username = isAdmin && typeof body.requestedBy === "string"
    ? cleanText(body.requestedBy, 40) || session.username
    : session.username;
  return store.users.find(
    (user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
  )?.username || null;
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
  const { id, name, code, categoryId, status, loan, image } = item;
  return { id, name, code, categoryId, status, loan, ...(image ? { image } : {}) };
}

function decodeProductImage(dataUrl) {
  const match = typeof dataUrl === "string"
    ? dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  if (!match) {
    const error = new Error("La imagen debe estar en formato PNG, JPG o WebP.");
    error.statusCode = 400;
    throw error;
  }
  const [, format, encoded] = match;
  const contents = Buffer.from(encoded, "base64");
  if (
    contents.length === 0 ||
    contents.length > MAX_IMAGE_BYTES ||
    contents.toString("base64") !== encoded
  ) {
    const error = new Error("La imagen no puede superar los 2 MB.");
    error.statusCode = 400;
    throw error;
  }
  const isPng = format === "png" &&
    contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = format === "jpeg" &&
    contents.length >= 3 &&
    contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff;
  const isWebp = format === "webp" &&
    contents.length >= 12 &&
    contents.toString("ascii", 0, 4) === "RIFF" &&
    contents.toString("ascii", 8, 12) === "WEBP";
  if (!isPng && !isJpeg && !isWebp) {
    const error = new Error("El contenido no coincide con el formato de imagen seleccionado.");
    error.statusCode = 400;
    throw error;
  }
  return {
    contents,
    extension: format === "jpeg" ? "jpg" : format,
  };
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

  if (request.method === "POST" && pathname === "/api/register") {
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
    if (store.users.some((user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
      sendJson(response, 409, { error: "Ya existe un usuario con ese nombre." });
      return;
    }
    const credentials = await hashPassword(password);
    if (store.users.some((user) => user.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
      sendJson(response, 409, { error: "Ya existe un usuario con ese nombre." });
      return;
    }
    const user = { username, role: "staff", ...credentials };
    store.users.push(user);
    await saveStore();
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(response, token);
    sendJson(response, 201, { user: safeUser(user) });
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

  if (request.method === "PATCH" && pathname === "/api/account/password") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(response, 400, { error: "Los datos de la contraseña no son válidos." });
      return;
    }
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 10 || newPassword.length > 200) {
      sendJson(response, 400, { error: "La nueva contraseña debe tener entre 10 y 200 caracteres." });
      return;
    }
    if (!await verifyPassword(currentPassword, currentUser)) {
      sendJson(response, 401, { error: "La contraseña actual es incorrecta." });
      return;
    }
    const credentials = await hashPassword(newPassword);
    currentUser.salt = credentials.salt;
    currentUser.hash = credentials.hash;
    for (const [token, sessionEntry] of sessions) {
      if (sessionEntry.username === currentUser.username && token !== session.token) {
        sessions.delete(token);
      }
    }
    await saveStore();
    sendJson(response, 200, { ok: true });
    return;
  }

  const imageMatch = pathname.match(/^\/api\/images\/([0-9a-f-]{36})\.(png|jpg|webp)$/i);
  if (request.method === "GET" && imageMatch) {
    const imagePath = path.join(IMAGE_DIR, `${imageMatch[1]}.${imageMatch[2].toLowerCase()}`);
    try {
      const contents = await fs.promises.readFile(imagePath);
      const contentType = imageMatch[2].toLowerCase() === "jpg"
        ? "image/jpeg"
        : `image/${imageMatch[2].toLowerCase()}`;
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(contents);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      sendJson(response, 404, { error: "No se encontró la imagen." });
    }
    return;
  }

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

  if (request.method === "PATCH" && pathname === "/api/users") {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede gestionar usuarios." });
      return;
    }
    const body = await readJson(request);
    const currentUsername = cleanText(body.currentUsername, 40);
    const username = cleanText(body.username, 40);
    if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)) {
      sendJson(response, 400, {
        error: "El usuario debe tener entre 3 y 40 letras, números, puntos, guiones o guiones bajos.",
      });
      return;
    }
    const user = store.users.find(
      (entry) => entry.username.toLocaleLowerCase() === currentUsername.toLocaleLowerCase(),
    );
    if (!user) {
      sendJson(response, 404, { error: "No se encontró el usuario que quieres modificar." });
      return;
    }
    if (store.users.some(
      (entry) => entry !== user && entry.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
    )) {
      sendJson(response, 409, { error: "Ya existe un usuario con ese nombre." });
      return;
    }
    const previousUsername = user.username;
    user.username = username;
    for (const sessionEntry of sessions.values()) {
      if (sessionEntry.username === previousUsername) sessionEntry.username = username;
    }
    for (const item of store.items) {
      if (item.loan?.requestedBy === previousUsername) item.loan.requestedBy = username;
    }
    await saveStore();
    sendJson(response, 200, { user: safeUser(user) });
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
    const body = await readJson(request, MAX_IMAGE_REQUEST_BYTES);
    const name = cleanText(body.name, 100);
    const code = cleanText(body.code, 50);
    const quantity = body.quantity === undefined ? 1 : body.quantity;
    const category = store.categories.find((entry) => entry.id === body.categoryId);
    if (!name || !category) {
      sendJson(response, 400, { error: "Indica el nombre del implemento y una categoría válida." });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      sendJson(response, 400, { error: "La cantidad debe ser un número entero entre 1 y 100." });
      return;
    }
    const codes = Array.from({ length: quantity }, (_, index) => {
      if (!code) return "";
      if (quantity === 1) return code;
      const suffixWidth = Math.max(2, String(quantity).length);
      const suffix = `-${String(index + 1).padStart(suffixWidth, "0")}`;
      return `${code.slice(0, 50 - suffix.length)}${suffix}`;
    });
    const normalizedCodes = codes.filter(Boolean).map((value) => value.toLocaleLowerCase());
    if (
      new Set(normalizedCodes).size !== normalizedCodes.length ||
      normalizedCodes.some((value) =>
        store.items.some((item) => item.code.toLocaleLowerCase() === value),
      )
    ) {
      sendJson(response, 409, { error: "Uno o más códigos ya existen en el inventario." });
      return;
    }

    let imageUrl = "";

    if (body.image) {
      // Validar formato y tamaño antes de subir.
      decodeProductImage(body.image);

      const result = await cloudinary.uploader.upload(body.image, {
        folder: "sport-control/items",
        resource_type: "image",
      });

      imageUrl = result.secure_url;
    }
    const items = codes.map((itemCode) => ({
      id: randomUUID(),
      name,
      code: itemCode,
      categoryId: category.id,
      status: "available",
      loan: null,
      ...(imageUrl ? { image: imageUrl } : {}),
    }));
    store.items.push(...items);
    await saveStore();
    sendJson(response, 201, {
      ...(quantity === 1 ? { item: publicItem(items[0]) } : {}),
      items: items.map(publicItem),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/items/checkout-batch") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(response, 400, { error: "Los datos del préstamo no son válidos." });
      return;
    }
    const ids = body.ids;
    const person = cleanText(body.person, 100);
    const reason = cleanText(body.reason, 240);
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    ) {
      sendJson(response, 400, { error: "Selecciona entre 1 y 100 implementos distintos." });
      return;
    }
    if (!person || !reason) {
      sendJson(response, 400, { error: "Indica quién recibe los implementos y el motivo del préstamo." });
      return;
    }
    const requestedBy = resolveRequester(body, session, isAdmin);
    if (!requestedBy) {
      sendJson(response, 404, { error: "No se encontró la cuenta que solicita el préstamo." });
      return;
    }
    const items = ids.map((id) => store.items.find((entry) => entry.id === id));
    if (items.some((item) => !item)) {
      sendJson(response, 404, { error: "Uno o más implementos seleccionados ya no existen." });
      return;
    }
    if (items.some((item) => item.status !== "available")) {
      sendJson(response, 409, { error: "Uno o más implementos seleccionados ya no están disponibles." });
      return;
    }
    const checkedOutAt = new Date().toISOString();
    for (const item of items) {
      item.status = "borrowed";
      item.loan = {
        person,
        reason,
        checkedOutAt,
        checkedOutBy: session.username,
        requestedBy,
      };
    }
    await saveStore();
    sendJson(response, 200, { items: items.map(publicItem) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/items/return-person") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(response, 400, { error: "Los datos de la devolución no son válidos." });
      return;
    }
    const person = cleanText(body.person, 100);
    if (!person) {
      sendJson(response, 400, { error: "Indica la persona a quien corresponden los implementos." });
      return;
    }
    const personKey = person.toLocaleLowerCase();
    const matchingItems = store.items.filter((item) =>
      item.status === "borrowed" &&
      typeof item.loan?.person === "string" &&
      item.loan.person.trim().toLocaleLowerCase() === personKey,
    );
    if (matchingItems.length === 0) {
      sendJson(response, 409, { error: "Esta persona ya no tiene implementos prestados." });
      return;
    }
    const items = isAdmin
      ? matchingItems
      : matchingItems.filter((item) => item.loan.requestedBy === session.username);
    if (items.length === 0) {
      sendJson(response, 403, { error: "Solo quien solicitó estos implementos o un administrador puede devolverlos." });
      return;
    }
    for (const item of items) {
      item.status = "available";
      item.loan = null;
    }
    await saveStore();
    sendJson(response, 200, { items: items.map(publicItem) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/items/delete-batch") {
    if (!isAdmin) {
      sendJson(response, 403, { error: "Solo un administrador puede eliminar implementos." });
      return;
    }
    const body = await readJson(request);
    const ids = body && !Array.isArray(body) ? body.ids : null;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    ) {
      sendJson(response, 400, { error: "Selecciona entre 1 y 100 implementos distintos." });
      return;
    }
    const items = ids.map((id) => store.items.find((entry) => entry.id === id));
    if (items.some((item) => !item)) {
      sendJson(response, 404, { error: "Uno o más implementos seleccionados ya no existen." });
      return;
    }
    if (items.some((item) => item.status === "borrowed")) {
      sendJson(response, 409, { error: "Devuelve los implementos prestados antes de eliminarlos." });
      return;
    }
    const selectedIds = new Set(ids);
    store.items = store.items.filter((item) => !selectedIds.has(item.id));
    await saveStore();
    sendJson(response, 200, { deleted: items.length });
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
      const requestedBy = resolveRequester(body, session, isAdmin);
      if (!requestedBy) {
        sendJson(response, 404, { error: "No se encontró la cuenta que solicita el préstamo." });
        return;
      }
      item.status = "borrowed";
      item.loan = {
        person,
        reason,
        checkedOutAt: new Date().toISOString(),
        checkedOutBy: session.username,
        requestedBy,
      };
    } else if (action === "return") {
      if (item.status !== "borrowed") {
        sendJson(response, 409, { error: "El implemento no figura como prestado." });
        return;
      }
      if (!isAdmin && item.loan?.requestedBy !== session.username) {
        sendJson(response, 403, { error: "Solo quien solicitó este implemento o un administrador puede devolverlo." });
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
