import { createProfileStatistics } from "./statistics.js";
import { renderAvatar } from "./avatar.js";
import { fetchCurrentUser, setCurrentAccount, getCachedProfile } from "./current-user.js";
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const account = document.querySelector("#account");
const message = document.querySelector("#auth-message");
const usernameForm = document.querySelector("#username-form");
const passwordForm = document.querySelector("#password-form");
const deleteAccountForm = document.querySelector("#delete-account-form");
const profileStatistics = createProfileStatistics(document.querySelector("#profile-statistics"));
let busy = false;
let currentUser = null;
let accountVerified = false;
let pendingFile = null;
let previewUrl = null;
const avatarFile = document.querySelector("#avatar-file");
const avatarMessage = document.querySelector("#avatar-message");

function syncAvatarControls() {
  document.querySelector("#avatar-save").disabled = busy || !accountVerified || !pendingFile;
  document.querySelector("#avatar-cancel").hidden = !pendingFile;
  document.querySelector("#avatar-remove").hidden = !currentUser?.avatar;
}
function clearAvatarSelection() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  pendingFile = null;
  avatarFile.value = "";
}
function renderProfileImages() {
  renderAvatar(document.querySelector("#profile-avatar"), currentUser, previewUrl);
  renderAvatar(document.querySelector("#avatar-preview"), currentUser, previewUrl);
  document.querySelector("#avatar-file-name").textContent = pendingFile
    ? `${pendingFile.name} · vēl nav saglabāts`
    : currentUser?.avatar ? "Tava pašreizējā profila bilde" : "Izvēlies savu profila bildi.";
  syncAvatarControls();
}
function resetAccount() {
  profileStatistics.clear();
  accountVerified = false;
  setCurrentAccount(null);
  currentUser = null;
  clearAvatarSelection();
  avatarMessage.textContent = "";
  document.querySelector("#auth-panel").classList.remove("is-account");
}


function setBusy(value) {
  busy = value;
  document.querySelectorAll("#auth-panel button, #auth-panel input").forEach((control) => {
    control.disabled = value || (!accountVerified && Boolean(control.closest("#account")));
  });
  document
    .querySelector("#auth-panel")
    .setAttribute("aria-busy", String(value));
  syncAvatarControls();
}

async function request(endpoint, options) {
  const response = await fetch(endpoint, {
    credentials: "same-origin",
    ...options,
  });
  const result =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error || "Neizdevās sazināties ar serveri.");
    if (result && Object.hasOwn(result, "banExpiresAt")) {
      error.banExpiresAt = result.banExpiresAt;
    }
    throw error;
  }
  return result;
}

function showMessage(text) {
  message.textContent = text;
}

function formatBanTime(banExpiresAt) {
  const expiresAt = new Date(banExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return null;

  let secondsRemaining = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
  const units = [
    ["diena", 24 * 60 * 60],
    ["stunda", 60 * 60],
    ["minūte", 60],
    ["sekunde", 1],
  ];
  const parts = [];

  for (const [label, unitSeconds] of units) {
    const amount = Math.floor(secondsRemaining / unitSeconds);
    if (amount > 0) {
      parts.push(`${amount} ${label}${amount === 1 ? "" : "s"}`);
      secondsRemaining %= unitSeconds;
      if (parts.length === 2) break;
    }
  }

  return parts.join(" ");
}

function showAccount(user, announce = true, verified = true) {
  accountVerified = verified;  if (announce) setCurrentAccount(user);
  currentUser = user;
  if (verified) void profileStatistics.load(user.id);
  document.querySelector("#auth-panel").classList.add("is-account");
  renderProfileImages();
  loginForm.hidden = true;
  registerForm.hidden = true;
  document.querySelector(".auth-tabs").hidden = true;
  account.hidden = false;
  document.querySelector("#account-title").textContent = user.username;
  document.querySelector("#account-name").textContent = user.name || "";
  document.querySelector("#account-email").textContent = user.email;
  document.querySelector("#current-username").textContent = user.username;
}

async function submitAuth(form, endpoint) {
  if (busy) return;
  showMessage("");
  const values = Object.fromEntries(new FormData(form));
  if (form === registerForm && values.password !== values.confirmPassword) {
    showMessage("Paroles nesakrīt.");
    return;
  }
  delete values.confirmPassword;
  setBusy(true);
  try {
    const result = await request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    loginForm.reset();
    registerForm.reset();
    showAccount(result.user);
    showMessage(
      form === registerForm
        ? "Konts izveidots. Jūs esat pieslēdzies."
        : "Pieslēgšanās veiksmīga.",
    );
  } catch (error) {
    if (endpoint === "/api/auth/login" && Object.hasOwn(error, "banExpiresAt")) {
      showMessage(error.banExpiresAt === null
        ? "Šis konts ir bloķēts pastāvīgi."
        : `Šis konts ir bloķēts vēl ${formatBanTime(error.banExpiresAt) || "īslaicīgi"}.`);
    } else {
      showMessage(error.message || "Neizdevās sazināties ar serveri.");
    }
  } finally {
    setBusy(false);
  }
}

document.querySelector("#show-login").addEventListener("click", () => {
  loginForm.hidden = false;
  registerForm.hidden = true;
  document.querySelector("#show-login").setAttribute("aria-pressed", "true");
  document
    .querySelector("#show-register")
    .setAttribute("aria-pressed", "false");
  showMessage("");
});

document.querySelector("#show-register").addEventListener("click", () => {
  loginForm.hidden = true;
  registerForm.hidden = false;
  document.querySelector("#show-login").setAttribute("aria-pressed", "false");
  document.querySelector("#show-register").setAttribute("aria-pressed", "true");
  showMessage("");
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuth(loginForm, "/api/auth/login");
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuth(registerForm, "/api/auth/register");
});

document.querySelector("#logout").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  try {
    await request("/api/auth/logout", { method: "POST" });
    account.hidden = true;
    resetAccount();
    document.querySelector(".auth-tabs").hidden = false;
    loginForm.hidden = false;
    document.querySelector("#show-login").setAttribute("aria-pressed", "true");
    document
      .querySelector("#show-register")
      .setAttribute("aria-pressed", "false");
    showMessage("Jūs esat izrakstījies.");
  } catch (error) {
    showMessage(error.message || "Neizdevās izrakstīties.");
  } finally {
    setBusy(false);
  }
});

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const username = new FormData(usernameForm).get("username");
  setBusy(true);
  showMessage("");
  try {
    const result = await request("/api/auth/username", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
      }),
    });
    showAccount(result.user);
    usernameForm.reset();
    showMessage("Lietotājvārds veiksmīgi nomainīts.");
  } catch (error) {
    showMessage(error.message || "Neizdevās nomainīt lietotājvārdu.");
  } finally {
    setBusy(false);
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const values = Object.fromEntries(new FormData(passwordForm));
  if (values.newPassword !== values.confirmPassword) {
    showMessage("Jaunās paroles nesakrīt.");
    return;
  }

  setBusy(true);
  showMessage("");
  try {
    await request("/api/auth/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    });
    passwordForm.reset();
    showMessage("Parole veiksmīgi nomainīta.");
  } catch (error) {
    showMessage(error.message || "Neizdevās nomainīt paroli.");
  } finally {
    setBusy(false);
  }
});

deleteAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const currentPassword = new FormData(deleteAccountForm).get("currentPassword");
  setBusy(true);
  showMessage("");
  try {
    await request("/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword,
      }),
    });
    account.hidden = true;
    resetAccount();
    document.querySelector(".auth-tabs").hidden = false;
    loginForm.hidden = false;
    document.querySelector("#show-login").setAttribute("aria-pressed", "true");
    document.querySelector("#show-register").setAttribute("aria-pressed", "false");
    deleteAccountForm.reset();
    showMessage("Konts ir dzēsts.");
  } catch (error) {
    showMessage(error.message || "Neizdevās dzēst kontu.");
  } finally {
    setBusy(false);
  }
});

avatarFile.addEventListener("change", () => {
  const file = avatarFile.files[0];
  if (!file) return;
  clearAvatarSelection();
  avatarMessage.textContent = "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
    avatarMessage.textContent = "Izvēlies JPG, PNG vai WebP attēlu līdz 5 MB.";
    renderProfileImages();
    return;
  }
  pendingFile = file;
  previewUrl = URL.createObjectURL(file);
  renderProfileImages();
});
document.querySelector("#avatar-cancel").addEventListener("click", () => {
  clearAvatarSelection();
  avatarMessage.textContent = "";
  renderProfileImages();
});
async function saveAvatar(remove = false) {
  if (busy || (!remove && !pendingFile)) return;
  setBusy(true);
  avatarMessage.textContent = remove ? "Noņem bildi…" : "Saglabā bildi…";
  try {
    const result = await request("/api/auth/avatar", remove ? { method: "DELETE" } : {
      method: "PUT", headers: { "Content-Type": pendingFile.type }, body: pendingFile,
    });
    clearAvatarSelection();
    showAccount(result.user);
    avatarMessage.textContent = remove ? "Profila bilde noņemta." : "Profila bilde saglabāta.";
  } catch (error) {
    avatarMessage.textContent = error.message || "Neizdevās saglabāt bildi. Mēģini vēlreiz.";
  } finally {
    setBusy(false);
  }
}
document.querySelector("#avatar-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveAvatar();
});
document.querySelector("#avatar-remove").addEventListener("click", () => saveAvatar(true));

const accountLoading = document.querySelector("#account-loading");
const retryAccount = document.querySelector("#retry-account");
async function loadAccount(refresh = false) {
  const cached = getCachedProfile();
  if (account.hidden && cached) showAccount(cached, false, false);
  setBusy(true);
  showMessage("");
  accountLoading.textContent = account.hidden ? "Ielādē kontu…" : "Atjauno profilu…";
  accountLoading.hidden = false;
  retryAccount.hidden = true;
  try {
    const response = await fetchCurrentUser({ refresh });
    if (response.status === 401) {
      account.hidden = true;
      resetAccount();
      document.querySelector(".auth-tabs").hidden = false;
      loginForm.hidden = false;
      return;
    }
    if (!response.ok) throw new Error("Session check failed");
    const result = await response.json();
    if (!result?.user) throw new Error("Missing account");
    showAccount(result.user, false);
  } catch {
    showMessage(account.hidden
      ? "Neizdevās ielādēt kontu. Mēģini vēlreiz."
      : "Redzams iepriekš ielādētais profils. Neizdevās pārbaudīt sesiju; pirms rediģēšanas mēģini vēlreiz.");
    retryAccount.hidden = false;
  } finally {
    accountLoading.hidden = true;
    setBusy(false);
  }
}
retryAccount.addEventListener("click", () => { if (!busy) void loadAccount(true); });
void loadAccount();
