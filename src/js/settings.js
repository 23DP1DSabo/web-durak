import { fetchCurrentUser } from "./current-user.js";
import { setTheme } from "./theme.js";

const settingsStatus = document.querySelector("#settings-status");
let authenticated = false;

const savedThemeInput = document.querySelector(
  `input[name="theme"][value="${document.body.dataset.theme.toUpperCase()}"]`,
);
if (savedThemeInput) savedThemeInput.checked = true;

async function requestTheme(theme) {
  const response = await fetch("/api/auth/theme", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || "Neizdevās saglabāt tēmu.");
  }
}

function showStatus(message, isError = false) {
  settingsStatus.textContent = message;
  settingsStatus.dataset.state = isError ? "error" : "success";
}

async function loadAccountTheme() {
  const response = await fetchCurrentUser();
  if (response.status === 401) return;
  if (!response.ok) throw new Error("Neizdevās ielādēt konta iestatījumus.");

  const { user } = await response.json();
  authenticated = true;
  const selectedTheme = document.querySelector(
    `input[name="theme"][value="${user.theme}"]`,
  );
  if (selectedTheme) selectedTheme.checked = true;
}

document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", async () => {
    const theme = input.value;
    setTheme(theme);
    if (!authenticated) {
      showStatus("Tēma nomainīta un saglabāta šajā pārlūkā.");
      return;
    }

    try {
      await requestTheme(theme);
      showStatus("Tēma nomainīta un saglabāta kontā.");
    } catch (error) {
      showStatus(`${error.message} Tēma saglabāta tikai šajā pārlūkā.`, true);
    }
  });
});

loadAccountTheme().catch((error) => showStatus(error.message, true));
