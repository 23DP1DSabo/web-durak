const list = document.querySelector("#history-list");
const status = document.querySelector("#history-status");
const more = document.querySelector("#history-more");
const login = document.querySelector("#history-login");
const modes = { classic: "Klasiskais duraks", passing: "Padošanas duraks", japan: "Japāņu duraks" };
const outcomes = { WIN: "Uzvara", DURAK: "Zaudējums", DRAW: "Neizšķirts" };
const reasons = { resign: "Padošanās", timeout: "Beidzās laiks", inactive: "Neaktivitāte" };
let cursor = null, busy = false, request = null;
const seen = new Set();
const date = new Intl.DateTimeFormat("lv-LV", { dateStyle: "medium", timeStyle: "short" });
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function render(game) {
  const card = element("li", "", "settings-section history-card");
  const heading = element("div", "", "history-heading");
  heading.append(element("h3", modes[game.mode] || game.mode), element("span", outcomes[game.result] || game.result, "history-result result-" + game.result.toLowerCase()));
  const time = element("time", date.format(new Date(game.endedAt))); time.dateTime = game.endedAt;
  const minutes = Math.floor(game.durationSeconds / 60), seconds = game.durationSeconds % 60;
  const meta = element("p", "", "history-meta"); meta.append(time, document.createTextNode(` · ${minutes} min ${seconds} s`));
  if (reasons[game.reason]) meta.append(document.createTextNode(` · ${reasons[game.reason]}`));
  const players = element("ul", "", "history-players");
  for (const player of game.players) {
    const row = element("li", "");
    row.append(element("span", player.name + (player.isSelf ? " (tu)" : "")), element("span", outcomes[player.result] || player.result));
    players.append(row);
  }
  card.append(heading, meta, players); list.append(card);
}
async function load(reset = false) {
  if (busy && !reset) return;
  if (reset) { request?.abort(); list.replaceChildren(); seen.clear(); cursor = null; }
  busy = true;
  const current = request = new AbortController();
  more.disabled = true; login.hidden = true;
  list.setAttribute("aria-busy", "true"); status.textContent = "Ielādē spēļu vēsturi…";
  try {
    const response = await fetch("/api/me/history" + (cursor ? "?before=" + encodeURIComponent(cursor) : ""), { credentials: "same-origin", signal: current.signal });
    if (response.status === 401) {
      list.replaceChildren(); seen.clear(); cursor = null;
      status.textContent = "Lai skatītu savu spēļu vēsturi, pieslēdzies.";
      login.hidden = false; more.hidden = true; return;
    }
    if (!response.ok) throw new Error("Neizdevās ielādēt spēļu vēsturi. Mēģini vēlreiz.");
    const data = await response.json();
    if (request !== current) return;
    for (const game of data.games) if (!seen.has(game.id)) { render(game); seen.add(game.id); }
    cursor = data.nextCursor; more.hidden = !cursor; more.textContent = "Ielādēt vēl";
    status.textContent = seen.size ? "" : "Vēl nav pabeigtu multiplayer spēļu. Pēc pirmās spēles tās rezultāts parādīsies šeit.";
  } catch (error) {
    if (request !== current || error.name === "AbortError") return;
    status.textContent = error.message; more.hidden = false; more.textContent = "Mēģināt vēlreiz";
  } finally {
    if (request === current) { busy = false; more.disabled = false; list.setAttribute("aria-busy", "false"); }
  }
}
more.addEventListener("click", () => void load());
window.addEventListener("pageshow", (event) => { if (event.persisted) void load(true); });
void load();
