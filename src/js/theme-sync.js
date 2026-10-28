export const themeKey = "durak-theme";
export const pendingThemeKey = "durak-theme-pending";
const revisionKey = "durak-theme-revision";
export const normalizeTheme = (value) =>
  typeof value === "string" && ["classic", "light", "dark", "modern"].includes(value.toLowerCase()) ? value.toLowerCase() : null;

// The browser applies its choice immediately. A small persistent outbox retries
// on the next page; optimistic DB versions make late requests harmless.
export function createThemeSync({ storage, fetchUser, save, apply, status = () => {}, cachedAccount = () => null }) {
  let account = null;
  let initialized = false;
  let running = null;
  let accountEpoch = 0;
  const memory = new Map();
  const read = (key) => { try { return storage.getItem(key); } catch { return memory.get(key) ?? null; } };
  const write = (key, value) => {
    memory.set(key, value);
    try { storage.setItem(key, value); } catch { /* Keep the current page usable. */ }
  };
  const remove = (key) => { memory.delete(key); try { storage.removeItem(key); } catch {} };
  function pendingChoice() {
    try {
      const value = JSON.parse(read(pendingThemeKey));
      return value && typeof value.id === "string" && normalizeTheme(value.theme)
        && (value.userId === null || typeof value.userId === "string") ? value : null;
    } catch { return null; }
  }
  const clearChoice = (choice) => {
    if (pendingChoice()?.id === choice.id) remove(pendingThemeKey);
  };
  function display(theme) {
    const value = normalizeTheme(theme);
    if (!value) return;
    write(themeKey, value);
    apply(value);
  }
  async function run() {
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!initialized) {
          const revision = read(revisionKey);
          const epoch = accountEpoch;
          const hadPending = Boolean(pendingChoice());
          const response = await fetchUser({ refresh: attempt > 0 });
          const result = response.ok ? await response.json() : null;
          if (epoch !== accountEpoch) continue;
          if (response.status === 401) {
            account = null;
            initialized = true;
          } else {
            if (!response.ok) throw new Error("Account lookup failed");
            account = result.user;
            initialized = true;
            if (!hadPending && !pendingChoice() && revision === read(revisionKey)) display(account.theme);
          }
        }
        const choice = pendingChoice();
        if (!choice) return;
        if (!account) {
          clearChoice(choice);
          status("local");
          return;
        }
        if (choice.userId !== null && choice.userId !== account.id) {
          clearChoice(choice);
          display(account.theme);
          return;
        }
        if (choice.userId === null) {
          choice.userId = account.id;
          if (pendingChoice()?.id === choice.id) write(pendingThemeKey, JSON.stringify(choice));
        }
        status("saving");
        const epoch = accountEpoch;
        const response = await save(choice.theme.toUpperCase(), account.themeVersion);
        if (epoch !== accountEpoch) continue;
        if (response.status === 409) {
          initialized = false;
          continue;
        }
        if (response.status === 401) {
          initialized = false;
          continue;
        }
        if (!response.ok) throw new Error("Theme save failed");
        const result = await response.json();
        if (epoch !== accountEpoch) continue;
        account = result.user;
        clearChoice(choice);
        if (!pendingChoice()) { status("saved"); return; }
      }
      status("retry");
    } catch {
      initialized = false;
      if (pendingChoice()) status("retry");
    }
  }
  function sync() {
    if (!running) running = run().finally(() => { running = null; });
    return running;
  }
  function select(theme) {
    const value = normalizeTheme(theme);
    if (!value) return false;
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    write(revisionKey, id);
    write(pendingThemeKey, JSON.stringify({ id, theme: value, userId: account?.id || cachedAccount()?.id || null }));
    display(value);
    void sync();
    return true;
  }
  function accountChanged(user) {
    if (user && initialized && user.id === account?.id) return;
    accountEpoch++;
    account = user;
    const choice = pendingChoice();
    if (choice && (!user || (choice.userId !== null && choice.userId !== user.id))) clearChoice(choice);
    initialized = true;
    if (user && !pendingChoice()) display(user.theme);
    void sync();
  }
  display(normalizeTheme(read(themeKey)) || "classic");
  return { select, sync, accountChanged, displayStored: () => apply(normalizeTheme(read(themeKey)) || "classic") };
}
