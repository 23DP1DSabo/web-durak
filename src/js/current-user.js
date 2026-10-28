// These short-lived previews only control rendering. Protected APIs still check the session.
const cacheKey = "durak-account-preview";
const profileKey = "durak-profile-preview";
const maxAge = 5 * 60 * 1000;
const recent = (savedAt) => Number.isFinite(savedAt) && Date.now() >= savedAt && Date.now() - savedAt < maxAge;
let pending = null;
let requestedAt = 0;
let settled = false;
let generation = 0;

export function getCachedAccount() {
  try {
    const entry = JSON.parse(sessionStorage.getItem(cacheKey));
    if (entry && recent(entry.savedAt) && typeof entry.id === "string"
      && typeof entry.username === "string" && ["USER", "ADMIN"].includes(entry.role)) return entry;
  } catch { /* Storage may be disabled. Fall back to the server. */ }
  return null;
}
function profileFields(user) {
  if (!user || typeof user.id !== "string" || typeof user.username !== "string"
    || typeof user.name !== "string" || typeof user.email !== "string"
    || !(user.avatar === null || typeof user.avatar === "string")
    || !["USER", "ADMIN"].includes(user.role) || !["CLASSIC", "LIGHT", "DARK", "MODERN"].includes(user.theme)
    || !Number.isSafeInteger(user.themeVersion) || user.themeVersion < 0) return null;
  // Never copy credentials, session tokens or arbitrary API fields into storage.
  return { id: user.id, username: user.username, name: user.name, email: user.email,
    avatar: user.avatar, role: user.role, theme: user.theme, themeVersion: user.themeVersion };
}
export function getCachedProfile() {
  try {
    const entry = JSON.parse(sessionStorage.getItem(profileKey));
    const user = profileFields(entry?.user);
    if (user && recent(entry.savedAt) && getCachedAccount()?.id === user.id) return user;
  } catch { /* Invalid/blocked storage falls back to the normal loading state. */ }
  return null;
}
function cacheAccount(user) {
  try {
    if (user) sessionStorage.setItem(cacheKey, JSON.stringify({
      id: user.id, username: user.username, role: user.role, savedAt: Date.now(),
    }));
    else sessionStorage.removeItem(cacheKey);
    const profile = profileFields(user);
    if (profile) sessionStorage.setItem(profileKey, JSON.stringify({ savedAt: Date.now(), user: profile }));
    else sessionStorage.removeItem(profileKey);
  } catch { /* A blocked cache must not prevent login or navigation. */ }
}
export function setCurrentAccount(user) {
  generation++;
  pending = null;
  cacheAccount(user);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("durak-account-changed", { detail: user }));
}
export function fetchCurrentUser({ refresh = false } = {}) {
  if (!pending || refresh || (settled && Date.now() - requestedAt > 1000)) {
    requestedAt = Date.now();
    settled = false;
    const version = generation;
    const request = fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const data = response.ok ? await response.clone().json().catch(() => null) : null;
        if (version === generation && pending === request) {
          if (response.status === 401) cacheAccount(null);
          else if (data?.user) cacheAccount(data.user);
        }
        return response;
      });
    pending = request;
    request.then(() => {
      if (pending === request) settled = true;
    }, () => {
      if (pending === request) pending = null;
    });
  }
  return pending.then((response) => response.clone());
}
