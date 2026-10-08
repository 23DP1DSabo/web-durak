const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const account = document.querySelector("#account");
const message = document.querySelector("#auth-message");

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
  showMessage("");
  const values = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Neizdevās pieteikties.");
    showAccount(result.user);
    showMessage("Pieslēgšanās veiksmīga.");
  } catch (error) {
    showMessage(error.message || "Neizdevās sazināties ar serveri.");
  }
}

document.querySelector("#show-login").addEventListener("click", () => {
  loginForm.hidden = false;
  registerForm.hidden = true;
  document.querySelector("#show-login").setAttribute("aria-pressed", "true");
  document.querySelector("#show-register").setAttribute("aria-pressed", "false");
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
  await fetch("/api/auth/logout", { method: "POST" });
  account.hidden = true;
  document.querySelector(".auth-tabs").hidden = false;
  loginForm.hidden = false;
  document.querySelector("#show-login").setAttribute("aria-pressed", "true");
  document.querySelector("#show-register").setAttribute("aria-pressed", "false");
  showMessage("Jūs esat izrakstījies.");
});

fetch("/api/auth/me")
  .then((response) => (response.ok ? response.json() : null))
  .then((result) => {
    if (result?.user) showAccount(result.user);
  })
  .catch(() => showMessage("Neizdevās pārbaudīt pieslēgšanās statusu."));