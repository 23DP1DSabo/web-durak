import { fetchCurrentUser } from "./current-user.js";
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const account = document.querySelector("#account");
const message = document.querySelector("#auth-message");
let busy = false;

function setBusy(value) {
  busy = value;
  document.querySelectorAll("#auth-panel button").forEach((button) => {
    button.disabled = value;
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
  if (!response.ok)
    throw new Error(result?.error || "Neizdevās sazināties ar serveri.");
  return result;
}

function showMessage(text) {
  message.textContent = text;
}

function showAccount(user) {
  loginForm.hidden = true;
  registerForm.hidden = true;
  document.querySelector(".auth-tabs").hidden = true;
  account.hidden = false;
  document.querySelector("#account-name").textContent = user.name || "Konts";
  document.querySelector("#account-email").textContent = user.email;
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
    showMessage(error.message || "Neizdevās sazināties ar serveri.");
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
