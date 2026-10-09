const authScreen = document.querySelector("#auth-screen");
const appScreen = document.querySelector("#app-screen");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const authTitle = document.querySelector("#auth-title");
const authDescription = document.querySelector("#auth-description");
const authSubmit = document.querySelector("#auth-submit");
const confirmPasswordField = document.querySelector("#confirm-password-field");
const confirmPasswordInput = document.querySelector("#auth-confirm-password");
const setupNote = document.querySelector("#setup-note");
const toast = document.querySelector("#toast");

let setupRequired = false;
let appData = { user: null, categories: [], items: [], users: [] };
let activeView = "dashboard";
let toastTimer;

const statusLabels = {
  available: "Disponible",
  borrowed: "En uso",
  maintenance: "Mantenimiento",
  lost: "Perdido",
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
  return result;
}

function showError(element, message) {
  element.textContent = message;
  element.classList.remove("hidden");
}

function hideError(element) {
  element.textContent = "";
  element.classList.add("hidden");
}

function notify(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function setAuthMode(isSetup) {
  setupRequired = isSetup;
  authTitle.textContent = isSetup ? "Crea tu cuenta de encargado" : "Bienvenido de nuevo";
  authDescription.textContent = isSetup
    ? "Configura la cuenta que administrará el inventario."
    : "Inicia sesión para administrar los implementos deportivos.";
  authSubmit.textContent = isSetup ? "Crear cuenta y continuar" : "Iniciar sesión";
  confirmPasswordField.classList.toggle("hidden", !isSetup);
  confirmPasswordInput.required = isSetup;
  setupNote.classList.toggle("hidden", !isSetup);
  document.querySelector("#auth-password").setAttribute(
    "autocomplete",
    isSetup ? "new-password" : "current-password",
  );
  hideError(authError);
}

async function refreshData() {
  appData = await api("/api/data");
  document.querySelector("#user-name").textContent = appData.user.username;
  document.querySelector("#user-avatar").textContent = appData.user.username.charAt(0);
  document.querySelector("#user-role").textContent =
    appData.user.role === "admin" ? "Administrador" : "Personal";
  for (const element of document.querySelectorAll(".admin-only")) {
    element.classList.toggle("hidden", appData.user.role !== "admin");
  }
  setView(activeView);
  render();
}

function showApp() {
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  refreshData().catch((error) => {
    if (error.message.includes("Inicia sesión")) {
      showAuth();
    } else {
      notify(error.message, true);
    }
  });
}

function showAuth() {
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  appData = { user: null, categories: [], items: [], users: [] };
  activeView = "dashboard";
  for (const element of document.querySelectorAll(".admin-only")) {
    element.classList.add("hidden");
  }
  authForm.reset();
  setAuthMode(setupRequired);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function categoryName(categoryId) {
  return appData.categories.find((category) => category.id === categoryId)?.name || "Sin categoría";
}

function formatDate(isoString) {
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(isoString));
}

function renderDashboard() {
  const items = appData.items;
  const available = items.filter((item) => item.status === "available").length;
  const borrowed = items.filter((item) => item.status === "borrowed").length;
  const attention = items.filter((item) => ["maintenance", "lost"].includes(item.status)).length;
  document.querySelector("#stat-total").textContent = items.length;
  document.querySelector("#stat-available").textContent = available;
  document.querySelector("#stat-borrowed").textContent = borrowed;
  document.querySelector("#stat-attention").textContent = attention;
  document.querySelector("#lost-alert").classList.toggle(
    "hidden",
    !items.some((item) => item.status === "lost"),
  );

  const loans = items.filter((item) => item.status === "borrowed");
  document.querySelector("#recent-loans").innerHTML = loans.length
    ? loans.slice(0, 6).map((item) => `
      <div class="loan-row">
        <div><span class="loan-name">${escapeHtml(item.name)}</span>${item.code ? `<span class="loan-code">${escapeHtml(item.code)}</span>` : ""}</div>
        <div><span class="person-name">${escapeHtml(item.loan.person)}</span><span class="loan-date">Desde ${formatDate(item.loan.checkedOutAt)}</span></div>
        <span class="loan-reason">${escapeHtml(item.loan.reason)}</span>
        <button class="small-action" type="button" data-action="return" data-id="${item.id}">Registrar devolución</button>
      </div>
    `).join("")
    : '<div class="empty-inline">No hay préstamos activos por ahora.</div>';

  document.querySelector("#category-summary").innerHTML = appData.categories.length
    ? appData.categories.map((category) => {
      const categoryItems = items.filter((item) => item.categoryId === category.id);
      const count = categoryItems.length;
      const availableCount = categoryItems.filter((item) => item.status === "available").length;
      const borrowedCount = categoryItems.filter((item) => item.status === "borrowed").length;
      const availableWidth = count ? Math.round((availableCount / count) * 100) : 0;
      const borrowedWidth = count ? Math.round((borrowedCount / count) * 100) : 0;
      return `<div class="category-card"><div class="category-card-top"><span class="category-mark">◇</span><div><strong>${escapeHtml(category.name)}</strong><span>${count} ${count === 1 ? "implemento" : "implementos"}</span></div></div><div class="category-meter" aria-label="${availableCount} disponibles y ${borrowedCount} en uso"><span class="meter-available" style="width:${availableWidth}%"></span><span class="meter-borrowed" style="width:${borrowedWidth}%"></span></div></div>`;
    }).join("")
    : '<div class="empty-inline">Aún no hay categorías configuradas.</div>';
}

function renderInventory() {
  const search = document.querySelector("#search-input").value.trim().toLocaleLowerCase();
  const selectedCategory = document.querySelector("#category-filter").value;
  const selectedStatus = document.querySelector("#status-filter").value;
  const items = appData.items.filter((item) => {
    const matchesSearch = `${item.name} ${item.code}`.toLocaleLowerCase().includes(search);
    return matchesSearch &&
      (!selectedCategory || item.categoryId === selectedCategory) &&
      (!selectedStatus || item.status === selectedStatus);
  });

  document.querySelector("#inventory-body").innerHTML = items.map((item) => {
    const loan = item.loan;
    const details = loan
      ? `<div class="loan-cell"><strong>${escapeHtml(loan.person)}</strong><span>${escapeHtml(loan.reason)}</span></div>`
      : '<span class="muted">—</span>';
    let actions = '<span class="muted">—</span>';
    if (item.status === "borrowed") {
      actions = `<button class="small-action" type="button" data-action="return" data-id="${item.id}">Devolver</button>${appData.user.role === "admin" ? `<button class="small-action danger" type="button" data-action="status" data-status="lost" data-id="${item.id}">Reportar pérdida</button>` : ""}`;
    } else if (item.status === "available") {
      actions = `<button class="small-action" type="button" data-action="checkout" data-id="${item.id}">Prestar</button>${appData.user.role === "admin" ? `<button class="small-action" type="button" data-action="status" data-status="maintenance" data-id="${item.id}">Mantenimiento</button><button class="small-action danger" type="button" data-action="delete" data-id="${item.id}">Eliminar</button>` : ""}`;
    } else if (appData.user.role === "admin") {
      const nextLabel = item.status === "lost" ? "Marcar disponible" : "Habilitar";
      actions = `<button class="small-action" type="button" data-action="status" data-status="available" data-id="${item.id}">${nextLabel}</button><button class="small-action danger" type="button" data-action="delete" data-id="${item.id}">Eliminar</button>`;
    }
    return `<tr>
      <td class="item-cell"><strong>${escapeHtml(item.name)}</strong><span>${item.code ? `Código: ${escapeHtml(item.code)}` : "Sin código asignado"}</span></td>
      <td>${escapeHtml(categoryName(item.categoryId))}</td>
      <td><span class="status-pill status-${item.status}">${statusLabels[item.status]}</span></td>
      <td>${details}</td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
  }).join("");
  document.querySelector("#inventory-empty").classList.toggle("hidden", items.length > 0);
  document.querySelector("#inventory-empty p").textContent = appData.user.role === "admin"
    ? "Agrega un implemento o cambia los filtros de búsqueda."
    : "Prueba cambiar los filtros de búsqueda.";
  document.querySelector(".table-wrap table").classList.toggle("hidden", items.length === 0);
}

function renderCategories() {
  document.querySelector("#category-list").innerHTML = appData.categories.length
    ? appData.categories.map((category) => {
      const count = appData.items.filter((item) => item.categoryId === category.id).length;
      const deleteButton = appData.user.role === "admin"
        ? `<button class="delete-category" type="button" data-action="delete-category" data-id="${category.id}">Eliminar</button>`
        : "";
      return `<div class="category-list-row"><span class="category-mark">◇</span><strong>${escapeHtml(category.name)}</strong><span>${count} ${count === 1 ? "implemento" : "implementos"}</span>${deleteButton}</div>`;
    }).join("")
    : '<div class="empty-inline">Aún no tienes categorías. Agrega una para organizar el inventario.</div>';
}

function renderUsers() {
  const users = Array.isArray(appData.users) ? appData.users : [];
  document.querySelector("#user-list").innerHTML = users.map((user) => `
    <div class="category-list-row">
      <span class="category-mark">♙</span>
      <strong>${escapeHtml(user.username)}${user.username === appData.user.username ? " (tú)" : ""}</strong>
      <span>${user.role === "admin" ? "Administrador" : "Personal"}</span>
      ${user.username === appData.user.username ? "" : `<button class="delete-category" type="button" data-action="delete-user" data-username="${escapeHtml(user.username)}">Eliminar</button>`}
    </div>
  `).join("");
}

function renderFilters() {
  const filter = document.querySelector("#category-filter");
  const selected = filter.value;
  filter.innerHTML = '<option value="">Todas las categorías</option>' +
    appData.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  filter.value = appData.categories.some((category) => category.id === selected) ? selected : "";

  const select = document.querySelector("#item-category");
  select.innerHTML = appData.categories.map((category) =>
    `<option value="${category.id}">${escapeHtml(category.name)}</option>`,
  ).join("");
  document.querySelector("#item-dialog").querySelector('[type="submit"]').disabled = appData.categories.length === 0;
}

function render() {
  renderFilters();
  renderDashboard();
  renderInventory();
  renderCategories();
  renderUsers();
}

function setView(view) {
  if (view === "users" && appData.user?.role !== "admin") view = "dashboard";
  if (view === "categories" && appData.user?.role !== "admin") view = "dashboard";
  activeView = view;
  for (const section of document.querySelectorAll(".view")) {
    section.classList.toggle("hidden", section.id !== `view-${view}`);
  }
  for (const button of document.querySelectorAll(".nav-link")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  const titles = { dashboard: "Resumen", inventory: "Implementos", categories: "Categorías", users: "Usuarios" };
  document.querySelector("#page-title").textContent = titles[view];
  document.querySelector("#page-eyebrow").textContent = view === "dashboard"
    ? "TU ESPACIO DEPORTIVO"
    : "GESTIÓN DE INVENTARIO";
  document.querySelector(".topbar-action").classList.toggle(
    "hidden",
    appData.user?.role !== "admin" || !["dashboard", "inventory"].includes(view),
  );
}

async function handleAction(button) {
  const { action, id } = button.dataset;
  const item = appData.items.find((entry) => entry.id === id);
  if (action === "add-item") {
    if (appData.categories.length === 0) {
      setView("categories");
      notify("Crea una categoría antes de agregar implementos.");
      return;
    }
    document.querySelector("#item-form").reset();
    hideError(document.querySelector("#item-error"));
    document.querySelector("#item-dialog").showModal();
  } else if (action === "checkout" && item) {
    document.querySelector("#loan-form").reset();
    document.querySelector("#loan-item-id").value = item.id;
    document.querySelector("#loan-item-name").textContent = item.name;
    hideError(document.querySelector("#loan-error"));
    document.querySelector("#loan-dialog").showModal();
    document.querySelector("#loan-person").focus();
  } else if (action === "return" && item) {
    if (!confirm(`¿Registrar la devolución de "${item.name}"?`)) return;
    await api(`/api/items/${id}/return`, { method: "PATCH", body: "{}" });
    await refreshData();
    notify("Devolución registrada.");
  } else if (action === "status" && item) {
    const status = button.dataset.status;
    await api(`/api/items/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await refreshData();
    notify(status === "maintenance"
      ? "Implemento enviado a mantenimiento."
      : "Estado del implemento actualizado.");
  } else if (action === "delete" && item) {
    if (!confirm(`¿Eliminar "${item.name}" del inventario?`)) return;
    await api(`/api/items/${id}`, { method: "DELETE" });
    await refreshData();
    notify("Implemento eliminado.");
  } else if (action === "delete-category") {
    const category = appData.categories.find((entry) => entry.id === id);
    if (!category || !confirm(`¿Eliminar la categoría "${category.name}"?`)) return;
    await api(`/api/categories/${id}`, { method: "DELETE" });
    await refreshData();
    notify("Categoría eliminada.");
  } else if (action === "delete-user") {
    const username = button.dataset.username;
    if (!username || !confirm(`¿Eliminar la cuenta de "${username}"?`)) return;
    await api("/api/users", {
      method: "DELETE",
      body: JSON.stringify({ username }),
    });
    await refreshData();
    notify("Cuenta eliminada.");
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(authError);
  const username = document.querySelector("#auth-username").value.trim();
  const password = document.querySelector("#auth-password").value;
  if (setupRequired && password !== confirmPasswordInput.value) {
    showError(authError, "Las contraseñas no coinciden.");
    return;
  }
  authSubmit.disabled = true;
  try {
    await api(setupRequired ? "/api/setup" : "/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    showApp();
  } catch (error) {
    showError(authError, error.message);
  } finally {
    authSubmit.disabled = false;
  }
});

document.querySelector("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError(document.querySelector("#item-error"));
  try {
    await api("/api/items", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        categoryId: form.get("categoryId"),
        code: form.get("code"),
        quantity: Number(form.get("quantity")),
      }),
    });
    const quantity = Number(form.get("quantity"));
    document.querySelector("#item-dialog").close();
    await refreshData();
    notify(quantity === 1
      ? "Implemento agregado al inventario."
      : `${quantity} implementos agregados al inventario.`);
  } catch (error) {
    showError(document.querySelector("#item-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#loan-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError(document.querySelector("#loan-error"));
  try {
    await api(`/api/items/${document.querySelector("#loan-item-id").value}/checkout`, {
      method: "PATCH",
      body: JSON.stringify({ person: form.get("person"), reason: form.get("reason") }),
    });
    document.querySelector("#loan-dialog").close();
    await refreshData();
    notify("Préstamo registrado correctamente.");
  } catch (error) {
    showError(document.querySelector("#loan-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#category-name");
  try {
    await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: input.value }),
    });
    input.value = "";
    await refreshData();
    notify("Categoría agregada.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.querySelector("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError(document.querySelector("#user-error"));
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
        role: form.get("role"),
      }),
    });
    event.currentTarget.reset();
    await refreshData();
    notify("Cuenta creada correctamente.");
  } catch (error) {
    showError(document.querySelector("#user-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  const button = document.querySelector("#logout-button");
  button.disabled = true;
  try {
    await api("/api/logout", { method: "POST" });
    showAuth();
    notify("Sesión cerrada correctamente.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  try {
    await handleAction(button);
  } catch (error) {
    notify(error.message, true);
  }
});

document.querySelector("#search-input").addEventListener("input", renderInventory);
document.querySelector("#category-filter").addEventListener("change", renderInventory);
document.querySelector("#status-filter").addEventListener("change", renderInventory);

async function initialize() {
  try {
    const status = await api("/api/status");
    setupRequired = status.setupRequired;
    setAuthMode(setupRequired);
    if (status.user) showApp();
    else showAuth();
    setView(activeView);
  } catch (error) {
    showError(authError, `No se pudo conectar con el servidor: ${error.message}`);
  }
}

initialize();
