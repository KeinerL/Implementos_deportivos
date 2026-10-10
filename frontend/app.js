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
const authModeToggle = document.querySelector("#auth-mode-toggle");
const toast = document.querySelector("#toast");
const itemImageInput = document.querySelector("#item-image");
const itemImagePreview = document.querySelector("#item-image-preview");
const itemImagePreviewImage = document.querySelector("#item-image-preview-img");

let setupRequired = false;
let registrationMode = false;
let appData = { user: null, categories: [], items: [], users: [] };
let activeView = "dashboard";
let toastTimer;
let itemImageObjectUrl;
let selectedItemIds = new Set();
let activeCheckoutIds = [];
let selectionMode = "checkout";

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
  if (!response.ok) {
    const message = response.status === 413 && path === "/api/items"
      ? "El servidor rechazó el tamaño de la imagen. Reinicia el servidor para aplicar los cambios y usa una imagen de hasta 2 MB."
      : result.error || "No se pudo completar la solicitud.";
    throw new Error(message);
  }
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("No se pudo leer la imagen seleccionada."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error || new Error("No se pudo leer la imagen seleccionada."));
    });
    reader.readAsDataURL(file);
  });
}

function clearItemImagePreview() {
  if (itemImageObjectUrl) URL.revokeObjectURL(itemImageObjectUrl);
  itemImageObjectUrl = undefined;
  itemImageInput.value = "";
  itemImagePreviewImage.removeAttribute("src");
  itemImagePreview.classList.add("hidden");
}

function notify(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function setAuthMode(isSetup, isRegistration = false) {
  setupRequired = isSetup;
  registrationMode = !isSetup && isRegistration;
  const creatingAccount = isSetup || registrationMode;
  authTitle.textContent = isSetup
    ? "Crea tu cuenta de encargado"
    : registrationMode ? "Crea tu cuenta" : "Bienvenido de nuevo";
  authDescription.textContent = isSetup
    ? "Configura la cuenta que administrará el inventario."
    : registrationMode
      ? "Regístrate para consultar el inventario y gestionar préstamos."
      : "Inicia sesión para administrar los implementos deportivos.";
  authSubmit.textContent = isSetup
    ? "Crear cuenta y continuar"
    : registrationMode ? "Crear cuenta" : "Iniciar sesión";
  confirmPasswordField.classList.toggle("hidden", !creatingAccount);
  confirmPasswordInput.required = creatingAccount;
  setupNote.textContent = isSetup
    ? "Crea la cuenta del encargado principal. El registro público se cerrará después de este paso."
    : "Tu cuenta tendrá permisos de personal. Un administrador puede cambiar tu rol.";
  setupNote.classList.toggle("hidden", !creatingAccount);
  authModeToggle.classList.toggle("hidden", isSetup);
  authModeToggle.textContent = registrationMode
    ? "¿Ya tienes cuenta? Iniciar sesión"
    : "¿No tienes cuenta? Crear cuenta";
  document.querySelector("#auth-password").setAttribute(
    "autocomplete",
    creatingAccount ? "new-password" : "current-password",
  );
  hideError(authError);
}

async function refreshData() {
  appData = await api("/api/data");
  const deleteMode = selectionMode === "delete" && appData.user.role === "admin";
  const availableIds = new Set(appData.items
    .filter((item) => deleteMode ? item.status !== "borrowed" : item.status === "available")
    .map((item) => item.id));
  selectedItemIds = new Set([...selectedItemIds].filter((id) => availableIds.has(id)));
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

function formatDateTime(isoString) {
  const date = new Date(isoString);
  if (!isoString || Number.isNaN(date.getTime())) return "Sin fecha registrada";
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function canReturnLoan(item) {
  return appData.user?.role === "admin" ||
    item.loan?.requestedBy === appData.user?.username;
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
  const loansByPerson = new Map();
  for (const item of loans) {
    const personKey = item.loan.person.trim().toLocaleLowerCase();
    if (!loansByPerson.has(personKey)) loansByPerson.set(personKey, []);
    loansByPerson.get(personKey).push(item);
  }
  const loanGroups = [...loansByPerson.values()];
  document.querySelector("#recent-loans").innerHTML = loanGroups.length
    ? loanGroups.map((personItems) => {
      const returnableItems = personItems.filter(canReturnLoan);
      return `
        <div class="loan-group">
          <div class="loan-group-heading">
            <div><span class="person-name">${escapeHtml(personItems[0].loan.person)}</span><span class="loan-date">${personItems.length} ${personItems.length === 1 ? "implemento en uso" : "implementos en uso"}</span></div>
            ${returnableItems.length
              ? `<button class="small-action" type="button" data-action="return-all" data-count="${returnableItems.length}" data-person="${escapeHtml(personItems[0].loan.person)}">Devolver todos</button>`
              : ""}
          </div>
          <div class="loan-group-items">${personItems.map((item) => `
            <div class="loan-row">
              <div><span class="loan-name">${escapeHtml(item.name)}</span>${item.code ? `<span class="loan-code">${escapeHtml(item.code)}</span>` : ""}</div>
              <span class="loan-reason">${escapeHtml(item.loan.reason)}</span>
              <span class="loan-date">Desde ${formatDateTime(item.loan.checkedOutAt)}</span>
              ${canReturnLoan(item)
                ? `<button class="small-action" type="button" data-action="return" data-id="${item.id}">Devolver</button>`
                : ""}
            </div>
          `).join("")}</div>
        </div>
      `;
    }).join("")
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
  const deleteMode = selectionMode === "delete" && appData.user.role === "admin";
  const search = document.querySelector("#search-input").value.trim().toLocaleLowerCase();
  const selectedCategory = document.querySelector("#category-filter").value;
  const selectedStatus = document.querySelector("#status-filter").value;
  const items = appData.items.filter((item) => {
    const matchesSearch = `${item.name} ${item.code}`.toLocaleLowerCase().includes(search);
    return matchesSearch &&
      (!selectedCategory || item.categoryId === selectedCategory) &&
      (!selectedStatus || item.status === selectedStatus);
  });
  const selectableItems = items.filter((item) =>
    deleteMode ? item.status !== "borrowed" : item.status === "available",
  );
  const selectVisibleItems = document.querySelector("#select-visible-items");
  selectVisibleItems.checked = selectableItems.length > 0 &&
    selectableItems.every((item) => selectedItemIds.has(item.id));
  selectVisibleItems.disabled = selectableItems.length === 0;
  selectVisibleItems.setAttribute(
    "aria-label",
    deleteMode ? "Seleccionar implementos visibles que no están prestados" : "Seleccionar implementos disponibles visibles",
  );
  const selectedCount = selectedItemIds.size;
  document.querySelector("#selection-toolbar").classList.toggle("hidden", selectedCount === 0 && !deleteMode);
  document.querySelector("#selection-count").textContent =
    `${selectedCount} ${selectedCount === 1 ? "implemento seleccionado" : "implementos seleccionados"}`;
  document.querySelector("#selection-hint").textContent = deleteMode
    ? "No se pueden eliminar implementos que están prestados."
    : "Se registrarán en el mismo préstamo";
  document.querySelector("#checkout-selected-button").classList.toggle("hidden", deleteMode);
  document.querySelector("#delete-selected-button").classList.toggle("hidden", !deleteMode);
  document.querySelector("#delete-selected-button").disabled = selectedCount === 0;
  document.querySelector("#delete-mode-button").textContent = deleteMode
    ? "Cancelar selección"
    : "Seleccionar para eliminar";

  document.querySelector("#inventory-body").innerHTML = items.map((item) => {
    const loan = item.loan;
    const details = loan
      ? `<div class="loan-cell"><strong>${escapeHtml(loan.person)}</strong><span>${escapeHtml(loan.reason)}</span><span>Desde ${formatDateTime(loan.checkedOutAt)}</span></div>`
      : '<span class="muted">—</span>';
    let actions = '<span class="muted">—</span>';
    if (item.status === "borrowed") {
      actions = `${canReturnLoan(item) ? `<button class="small-action" type="button" data-action="return" data-id="${item.id}">Devolver</button>` : ""}${appData.user.role === "admin" ? `<button class="small-action danger" type="button" data-action="status" data-status="lost" data-id="${item.id}">Reportar pérdida</button>` : ""}`;
    } else if (item.status === "available") {
      actions = `<button class="small-action" type="button" data-action="checkout" data-id="${item.id}">Prestar</button>${appData.user.role === "admin" ? `<button class="small-action" type="button" data-action="status" data-status="maintenance" data-id="${item.id}">Mantenimiento</button><button class="small-action danger" type="button" data-action="delete" data-id="${item.id}">Eliminar</button>` : ""}`;
    } else if (appData.user.role === "admin") {
      const nextLabel = item.status === "lost" ? "Marcar disponible" : "Habilitar";
      actions = `<button class="small-action" type="button" data-action="status" data-status="available" data-id="${item.id}">${nextLabel}</button><button class="small-action danger" type="button" data-action="delete" data-id="${item.id}">Eliminar</button>`;
    }
    const thumbnail = item.image
      ? `<img class="item-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy">`
      : '<span class="item-thumb-placeholder" aria-hidden="true">◫</span>';
    const canSelect = deleteMode
      ? item.status !== "borrowed"
      : item.status === "available";
    const selection = canSelect
      ? `<input class="item-selection" type="checkbox" data-select-item="${item.id}" aria-label="Seleccionar ${escapeHtml(item.name)}" ${selectedItemIds.has(item.id) ? "checked" : ""}>`
      : "";
    return `<tr>
      <td class="selection-cell">${selection}</td>
      <td class="item-cell">${thumbnail}<span class="item-description"><strong>${escapeHtml(item.name)}</strong><span>${item.code ? `Código: ${escapeHtml(item.code)}` : "Sin código asignado"}</span></span></td>
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
      <button class="delete-category" type="button" data-action="edit-user" data-username="${escapeHtml(user.username)}">Editar nombre</button>
      <button class="delete-category" type="button" data-action="reset-user-password" data-username="${escapeHtml(user.username)}">Cambiar contraseña</button>
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

  const requesterSelect = document.querySelector("#loan-requester");
  requesterSelect.required = appData.user.role === "admin";
  const selectedRequester = requesterSelect.value || appData.user.username;
  requesterSelect.innerHTML = appData.users.map((user) =>
    `<option value="${escapeHtml(user.username)}">${escapeHtml(user.username)} (${user.role === "admin" ? "Administrador" : "Personal"})</option>`,
  ).join("");
  requesterSelect.value = appData.users.some((user) => user.username === selectedRequester)
    ? selectedRequester
    : appData.user.username;
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
    clearItemImagePreview();
    hideError(document.querySelector("#item-error"));
    document.querySelector("#item-dialog").showModal();
  } else if (action === "checkout" && item) {
    activeCheckoutIds = [item.id];
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
  } else if (action === "return-all") {
    const person = button.dataset.person || "esta persona";
    const count = Number(button.dataset.count) || 0;
    if (count === 0 || !confirm(`¿Registrar la devolución de todos los implementos de "${person}"?`)) return;
    const result = await api("/api/items/return-person", {
      method: "POST",
      body: JSON.stringify({ person }),
    });
    await refreshData();
    notify(`Devolución registrada para ${result.items.length} implementos.`);
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
  } else if (action === "edit-user") {
    const username = button.dataset.username;
    if (!username) return;
    document.querySelector("#edit-user-current-name").value = username;
    document.querySelector("#edit-user-name").value = username;
    hideError(document.querySelector("#edit-user-error"));
    document.querySelector("#edit-user-dialog").showModal();
    document.querySelector("#edit-user-name").focus();
  } else if (action === "reset-user-password") {
    const username = button.dataset.username;
    if (!username) return;
    const form = document.querySelector("#reset-user-password-form");
    form.reset();
    document.querySelector("#reset-user-password-username").value = username;
    document.querySelector("#reset-user-password-title").textContent = `Cambiar contraseña de ${username}`;
    hideError(document.querySelector("#reset-user-password-error"));
    document.querySelector("#reset-user-password-dialog").showModal();
    document.querySelector("#reset-user-password-new").focus();
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(authError);
  const username = document.querySelector("#auth-username").value.trim();
  const password = document.querySelector("#auth-password").value;
  const creatingAccount = setupRequired || registrationMode;
  if (creatingAccount && password !== confirmPasswordInput.value) {
    showError(authError, "Las contraseñas no coinciden.");
    return;
  }
  authSubmit.disabled = true;
  try {
    await api(setupRequired ? "/api/setup" : registrationMode ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (creatingAccount) setAuthMode(false);
    showApp();
  } catch (error) {
    showError(authError, error.message);
  } finally {
    authSubmit.disabled = false;
  }
});

authModeToggle.addEventListener("click", () => {
  authForm.reset();
  setAuthMode(false, !registrationMode);
  document.querySelector("#auth-username").focus();
});

document.querySelector("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError(document.querySelector("#item-error"));
  try {
    const imageFile = form.get("image");
    if (imageFile instanceof File && imageFile.size > 2 * 1024 * 1024) {
      throw new Error("La imagen no puede superar los 2 MB.");
    }
    const image = imageFile instanceof File && imageFile.size > 0
      ? await fileToDataUrl(imageFile)
      : "";
    await api("/api/items", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        categoryId: form.get("categoryId"),
        code: form.get("code"),
        quantity: Number(form.get("quantity")),
        image,
      }),
    });
    const quantity = Number(form.get("quantity"));
    clearItemImagePreview();
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

itemImageInput.addEventListener("change", () => {
  const file = itemImageInput.files[0];
  if (itemImageObjectUrl) URL.revokeObjectURL(itemImageObjectUrl);
  itemImageObjectUrl = undefined;
  if (!file) {
    itemImagePreviewImage.removeAttribute("src");
    itemImagePreview.classList.add("hidden");
    return;
  }
  itemImageObjectUrl = URL.createObjectURL(file);
  itemImagePreviewImage.src = itemImageObjectUrl;
  itemImagePreview.classList.remove("hidden");
});

document.querySelector("#item-image-clear").addEventListener("click", clearItemImagePreview);

document.querySelector("#loan-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError(document.querySelector("#loan-error"));
  try {
    if (activeCheckoutIds.length > 1) {
      await api("/api/items/checkout-batch", {
        method: "POST",
        body: JSON.stringify({
          ids: activeCheckoutIds,
          person: form.get("person"),
          reason: form.get("reason"),
          requestedBy: appData.user.role === "admin"
            ? form.get("requestedBy")
            : appData.user.username,
        }),
      });
    } else {
      await api(`/api/items/${document.querySelector("#loan-item-id").value}/checkout`, {
        method: "PATCH",
        body: JSON.stringify({
          person: form.get("person"),
          reason: form.get("reason"),
          requestedBy: appData.user.role === "admin"
            ? form.get("requestedBy")
            : appData.user.username,
        }),
      });
    }
    const checkoutCount = activeCheckoutIds.length;
    activeCheckoutIds = [];
    selectedItemIds.clear();
    document.querySelector("#loan-dialog").close();
    await refreshData();
    notify(checkoutCount > 1
      ? `Préstamo registrado para ${checkoutCount} implementos.`
      : "Préstamo registrado correctamente.");
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
  const userForm = event.currentTarget;
  const form = new FormData(userForm);
  const submit = userForm.querySelector('[type="submit"]');
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
    userForm.reset();
    await refreshData();
    notify("Cuenta creada correctamente.");
  } catch (error) {
    showError(document.querySelector("#user-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#edit-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  hideError(document.querySelector("#edit-user-error"));
  try {
    await api("/api/users", {
      method: "PATCH",
      body: JSON.stringify({
        currentUsername: form.get("currentUsername"),
        username: form.get("username"),
      }),
    });
    document.querySelector("#edit-user-dialog").close();
    await refreshData();
    notify("Nombre de usuario actualizado.");
  } catch (error) {
    showError(document.querySelector("#edit-user-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#reset-user-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const newPassword = form.get("newPassword");
  const submit = formElement.querySelector('[type="submit"]');
  hideError(document.querySelector("#reset-user-password-error"));
  if (newPassword !== form.get("confirmNewPassword")) {
    showError(document.querySelector("#reset-user-password-error"), "Las contraseñas no coinciden.");
    return;
  }
  submit.disabled = true;
  try {
    await api("/api/users/password", {
      method: "PATCH",
      body: JSON.stringify({
        username: form.get("username"),
        newPassword,
      }),
    });
    document.querySelector("#reset-user-password-dialog").close();
    formElement.reset();
    notify("La contraseña se cambió correctamente. Las demás sesiones de esa cuenta se cerraron.");
  } catch (error) {
    showError(document.querySelector("#reset-user-password-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passwordForm = event.currentTarget;
  const form = new FormData(passwordForm);
  const newPassword = form.get("newPassword");
  const submit = passwordForm.querySelector('[type="submit"]');
  hideError(document.querySelector("#password-error"));
  if (newPassword !== form.get("confirmNewPassword")) {
    showError(document.querySelector("#password-error"), "Las nuevas contraseñas no coinciden.");
    return;
  }
  submit.disabled = true;
  try {
    await api("/api/account/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        newPassword,
      }),
    });
    document.querySelector("#password-dialog").close();
    passwordForm.reset();
    notify("Tu contraseña se actualizó correctamente.");
  } catch (error) {
    showError(document.querySelector("#password-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

for (const button of document.querySelectorAll("#password-button, #password-button-mobile")) {
  button.addEventListener("click", () => {
    document.querySelector("#password-form").reset();
    hideError(document.querySelector("#password-error"));
    document.querySelector("#password-dialog").showModal();
    document.querySelector("#current-password").focus();
  });
}

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
document.querySelector("#inventory-body").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-item]");
  if (!checkbox) return;
  if (checkbox.checked && selectedItemIds.size >= 100) {
    notify("Puedes seleccionar hasta 100 implementos.", true);
    renderInventory();
    return;
  }
  if (checkbox.checked) selectedItemIds.add(checkbox.dataset.selectItem);
  else selectedItemIds.delete(checkbox.dataset.selectItem);
  renderInventory();
});

document.querySelector("#select-visible-items").addEventListener("change", (event) => {
  const deleteMode = selectionMode === "delete" && appData.user.role === "admin";
  const search = document.querySelector("#search-input").value.trim().toLocaleLowerCase();
  const selectedCategory = document.querySelector("#category-filter").value;
  const selectedStatus = document.querySelector("#status-filter").value;
  const visibleSelectableItems = appData.items.filter((item) => {
    const matchesSearch = `${item.name} ${item.code}`.toLocaleLowerCase().includes(search);
    const eligible = deleteMode ? item.status !== "borrowed" : item.status === "available";
    return eligible &&
      matchesSearch &&
      (!selectedCategory || item.categoryId === selectedCategory) &&
      (!selectedStatus || item.status === selectedStatus);
  });
  const itemsToAdd = visibleSelectableItems.filter((item) => !selectedItemIds.has(item.id));
  const availableSlots = event.target.checked ? 100 - selectedItemIds.size : Infinity;
  if (event.target.checked && itemsToAdd.length > availableSlots) {
    notify("Puedes seleccionar hasta 100 implementos.", true);
  }
  if (event.target.checked) {
    for (const item of itemsToAdd.slice(0, availableSlots)) selectedItemIds.add(item.id);
  } else {
    for (const item of visibleSelectableItems) selectedItemIds.delete(item.id);
  }
  renderInventory();
});

document.querySelector("#delete-mode-button").addEventListener("click", () => {
  selectionMode = selectionMode === "delete" ? "checkout" : "delete";
  selectedItemIds.clear();
  renderInventory();
});

document.querySelector("#checkout-selected-button").addEventListener("click", () => {
  activeCheckoutIds = [...selectedItemIds];
  if (activeCheckoutIds.length === 0) return;
  const items = appData.items.filter((item) => activeCheckoutIds.includes(item.id));
  document.querySelector("#loan-form").reset();
  document.querySelector("#loan-item-id").value = "";
  document.querySelector("#loan-item-name").textContent =
    `Usar ${items.length} ${items.length === 1 ? "implemento" : "implementos"}`;
  hideError(document.querySelector("#loan-error"));
  document.querySelector("#loan-dialog").showModal();
  document.querySelector("#loan-person").focus();
});

document.querySelector("#delete-selected-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const ids = [...selectedItemIds];
  if (ids.length === 0 || selectionMode !== "delete" || appData.user.role !== "admin") return;
  if (!confirm(`¿Eliminar permanentemente los ${ids.length} implementos seleccionados? Esta acción no se puede deshacer.`)) return;
  button.disabled = true;
  try {
    const result = await api("/api/items/delete-batch", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    await refreshData();
    notify(`Se eliminaron ${result.deleted} implementos.`);
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});

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
