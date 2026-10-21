import { fetchCurrentUser } from "./current-user.js";
import { setTheme } from "./theme.js";

const accountSettings = document.querySelector("#account-settings");
const signInPrompt = document.querySelector("#settings-sign-in");
const settingsStatus = document.querySelector("#settings-status");
const usernameForm = document.querySelector("#username-form");
const passwordForm = document.querySelector("#password-form");
let busy = false;

const savedThemeInput = document.querySelector(
  `input[name="theme"][value="${document.body.dataset.theme.toUpperCase()}"]`,
);
if (savedThemeInput) savedThemeInput.checked = true;

async function request(url, options = {}) {
  const response =
    url === "/api/auth/me"
      ? await fetchCurrentUser()
      : await fetch(url, {
          credentials: "same-origin",
          ...options,
          headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
        });
  const result =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || "Neizdevās sazināties ar serveri.");
  }
  return result;
}

function setBusy(value) {
  busy = value;
  document
    .querySelectorAll("#account-settings button, #account-settings input")
    .forEach((control) => {
      control.disabled = value;
    });
  accountSettings.setAttribute("aria-busy", String(value));
}

function showStatus(message, isError = false) {
  settingsStatus.textContent = message;
  settingsStatus.dataset.state = isError ? "error" : "success";
}

async function loadAccount() {
  try {
    const { user } = await request("/api/auth/me");
    accountSettings.hidden = false;
    signInPrompt.hidden = true;
    document.querySelector("#current-username").textContent = user.username;
    const selectedTheme = document.querySelector(
      `input[name="theme"][value="${user.theme}"]`,
    );
    if (selectedTheme) selectedTheme.checked = true;
  } catch (error) {
    if (error.message === "Jūs neesat pieslēdzies.") {
      accountSettings.hidden = true;
      signInPrompt.hidden = false;
      return;
    }
    showStatus(error.message, true);
  }
}

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  setBusy(true);
  showStatus("");
  try {
    const { user } = await request("/api/auth/username", {
      method: "PATCH",
      body: JSON.stringify({
        username: new FormData(usernameForm).get("username"),
      }),
    });
    document.querySelector("#current-username").textContent = user.username;
    usernameForm.reset();
    showStatus("Lietotājvārds veiksmīgi nomainīts.");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const values = Object.fromEntries(new FormData(passwordForm));
  if (values.newPassword !== values.confirmPassword) {
    showStatus("Jaunās paroles nesakrīt.", true);
    return;
  }

  setBusy(true);
  showStatus("");
  try {
    await request("/api/auth/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    });
    passwordForm.reset();
    showStatus("Parole veiksmīgi nomainīta.");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
});

document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", async () => {
    const theme = input.value;
    setTheme(theme);
    showStatus("Tēma nomainīta.");

    if (accountSettings.hidden) return;
    try {
      await request("/api/auth/theme", {
        method: "PATCH",
        body: JSON.stringify({ theme: theme.toUpperCase() }),
      });
      showStatus("Tēma nomainīta un saglabāta kontā.");
    } catch (error) {
      showStatus(`${error.message} Tēma saglabāta tikai šajā pārlūkā.`, true);
    }
  });
});

loadAccount();
