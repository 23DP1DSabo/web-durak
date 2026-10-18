const themes = new Set(["classic", "light", "dark"]);
const storageKey = "durak-theme";

export function setTheme(theme) {
  const normalizedTheme = typeof theme === "string" ? theme.toLowerCase() : "";
  if (!themes.has(normalizedTheme)) return false;

  document.body.dataset.theme = normalizedTheme;
  localStorage.setItem(storageKey, normalizedTheme);
  return true;
}

const savedTheme = localStorage.getItem(storageKey);
setTheme(themes.has(savedTheme) ? savedTheme : "classic");

fetch("/api/auth/me", { cache: "no-store" })
  .then(async (response) => {
    if (!response.ok) return;
    const { user } = await response.json();
    setTheme(user.theme);
  })
  .catch(() => {
    // Keep the saved theme available when the account service is offline.
  });
