import { fetchCurrentUser } from "./current-user.js";
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const account = document.querySelector("#account");
const message = document.querySelector("#auth-message");
const usernameForm = document.querySelector("#username-form");
const passwordForm = document.querySelector("#password-form");
const deleteAccountForm = document.querySelector("#delete-account-form");
let busy = false;

function setBusy(value) {
  busy = value;
  document.querySelectorAll("#auth-panel button, #auth-panel input").forEach((control) => {
    control.disabled = value;
  });
  document
    .querySelector("#auth-panel")
    .setAttribute("aria-busy", String(value));
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

function showAccount(user) {
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
    document.querySelector("#current-username").textContent = result.user.username;
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

setBusy(true);
fetchCurrentUser()
  .then((response) => {
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("Session check failed");
    return response.json();
  })
  .then((result) => {
    if (result?.user) showAccount(result.user);
  })
  .catch(() => showMessage("Neizdevās pārbaudīt pieslēgšanās statusu."))
  .finally(() => setBusy(false));
