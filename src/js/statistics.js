export function createProfileStatistics(root) {
  let userId = null, controller = null;
  const status = root.querySelector("[data-stat-status]");
  const retry = root.querySelector("[data-stat-retry]");
  function clear() {
    controller?.abort(); controller = null; userId = null;
    for (const value of root.querySelectorAll("[data-stat]")) value.textContent = "—";
    status.textContent = "Ielādē statistiku…"; retry.hidden = true;
    root.setAttribute("aria-busy", "false");
  }
  async function load(id, force = false) {
    if (userId === id && !force) return;
    clear(); userId = id;
    const request = controller = new AbortController();
    root.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/me/statistics", { credentials: "same-origin", signal: request.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Lai skatītu statistiku, pieslēdzies vēlreiz." : "Neizdevās ielādēt statistiku.");
      const { statistics } = await response.json();
      if (controller !== request) return;
      for (const element of root.querySelectorAll("[data-stat]")) {
        element.textContent = statistics[element.dataset.stat] + (element.dataset.stat === "winRate" ? "%" : "");
      }
      status.textContent = statistics.total ? "" : "Vēl nav pabeigtu multiplayer spēļu.";
    } catch (error) {
      if (controller !== request || error.name === "AbortError") return;
      status.textContent = error.message; retry.hidden = false;
    } finally {
      if (controller === request) root.setAttribute("aria-busy", "false");
    }
  }
  retry.addEventListener("click", () => { if (userId) void load(userId, true); });
  return { load, clear };
}
