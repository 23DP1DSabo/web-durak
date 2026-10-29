import { fetchCurrentUser, getCachedAccount } from "./current-user.js";
import { createThemeSync, themeKey, pendingThemeKey } from "./theme-sync.js";
import "./presence.js"; // Every page loads theme.js, so the heartbeat runs everywhere.
const controller = createThemeSync({
  storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: (key) => localStorage.removeItem(key) },
  fetchUser: fetchCurrentUser,
  cachedAccount: getCachedAccount,
  save: (theme, expectedVersion) => fetch("/api/auth/theme", {
    method: "PATCH", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme, expectedVersion }),
  }),
  apply: (theme) => {
    document.body.dataset.theme = theme;
    document.querySelectorAll('input[name="theme"]').forEach((input) => { input.checked = input.value === theme.toUpperCase(); });
  },
  status: (state) => window.dispatchEvent(new CustomEvent("durak-theme-status", { detail: state })),
});
export const setTheme = (theme) => controller.select(theme);
void controller.sync();
window.addEventListener("online", () => void controller.sync());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) { controller.displayStored(); void controller.sync(); }
});
window.addEventListener("storage", (event) => {
  if (event.key === themeKey) controller.displayStored();
  if (event.key === pendingThemeKey && event.newValue) void controller.sync();
});
window.addEventListener("durak-account-changed", (event) => controller.accountChanged(event.detail));
