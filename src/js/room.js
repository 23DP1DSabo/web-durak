import { renderAvatar } from "./avatar.js";
import { queueRoomExit } from "./room-exit.js";
import { takeRoomHandoff } from "./room-handoff.js";

const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
};

const params = new URLSearchParams(location.search);
const roomCode = params.get("code")?.toUpperCase() ?? "";
const mode = params.get("mode") ?? "classic";
let isHost = params.get("role") === "host";

const playerList = document.querySelector("#player-list");
const playerCount = document.querySelector("#player-count");
const timeLimitStatus = document.querySelector("#time-limit-status");
const timeLimitInputs = document.querySelectorAll('input[name="time-limit"]');
const allowGuestsInput = document.querySelector("#allow-guests");
const beginButton = document.querySelector("#begin-match");
const statusElement = document.querySelector("#room-status");
const roomCodeElement = document.querySelector("#room-code");
const copyCodeButton = document.querySelector("#copy-room-code");
const copyCodeStatus = document.querySelector("#copy-room-status");

let room = null;
let playerName = "Viesis";
let busy = false;
let leaving = false;
let initializing = true;
let redirected = false;
let refreshing = false;
let pendingSettings = {};
let settingsRevision = 0;

function hasPendingSettings() {
  return Object.keys(pendingSettings).length > 0;
}

function renderSettings() {
  const settings = { ...room, ...pendingSettings };
  for (const input of timeLimitInputs) {
    if (settings.timeLimitSeconds !== undefined) {
      input.checked = Number(input.value) === settings.timeLimitSeconds;
    }
    input.disabled = leaving || !isHost || (room && room.status !== "waiting");
  }
  if (settings.timeLimitSeconds !== undefined) {
    timeLimitStatus.textContent = `Katram spēlētājam: ${settings.timeLimitSeconds / 60} min`;
  }
  if (settings.allowGuests !== undefined) {
    allowGuestsInput.checked = settings.allowGuests;
  }
  allowGuestsInput.disabled = leaving || !isHost || (room && room.status !== "waiting");
  beginButton.hidden = !isHost;
  beginButton.disabled = !isHost || !room || room.status !== "waiting" ||
    room.players.length < 1 || busy || hasPendingSettings();
}

let playerId = localStorage.getItem("durak-player-id");
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("durak-player-id", playerId);
}

if (/^[A-Z0-9]{8}$/.test(roomCode)) {
  roomCodeElement.textContent = roomCode;
  copyCodeButton.disabled = false;
}

async function copyRoomCode() {
  const code = roomCodeElement.textContent.trim();
  if (!/^[A-Z0-9]{8}$/.test(code)) return;
  copyCodeButton.disabled = true;
  copyCodeStatus.textContent = "";
  try {
    await navigator.clipboard.writeText(code);
    copyCodeStatus.textContent = "Istabas kods nokopēts!";
  } catch {
    // Support local HTTP/LAN play where the Clipboard API may be unavailable.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(roomCodeElement);
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      // Leave the code selected so the player can copy it manually.
    }
    if (copied) selection.removeAllRanges();
    copyCodeStatus.textContent = copied
      ? "Istabas kods nokopēts!"
      : "Neizdevās nokopēt automātiski. Nokopē atlasīto kodu manuāli.";
  } finally {
    copyCodeButton.disabled = false;
  }
}

function setStatus(message) {
  statusElement.textContent = message;
  if (!room) document.querySelector("#room-loading").textContent = message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error ||
        ([502, 503, 504].includes(response.status)
          ? "Spēles serveris pašlaik nav sasniedzams. Mēģini vēlreiz pēc brīža."
          : "Pieprasījums neizdevās."),
    );

    error.status = response.status;
    error.code = data.code;

    throw error;
  }

  return data;
}

async function loadPlayerName() {
  const storageKey = "durak-guest-name";
  playerName = sessionStorage.getItem(storageKey);

  if (!playerName) {
    const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;

    playerName = `Viesis${String(digits).padStart(5, "0")}`;
    sessionStorage.setItem(storageKey, playerName);
  }

  // Account names come from the authorized room response; don't delay joining
  // with a second session lookup before the server performs the same check.
}

function renderRoom() {
  if (!room || leaving) return;
  document.querySelector("#room-loading").hidden = true;
  document.querySelector(".room-lobby").hidden = false;
  isHost = room.selfId !== null && room.selfId === room.hostId;
  playerName =
    room.players.find((player) => player.id === room.selfId)?.name ||
    playerName;

  document.querySelector("#room-code").textContent = room.code;
  document.querySelector("#room-mode-name").textContent =
    modeNames[room.mode] ?? "Spēle";

  playerCount.textContent = String(room.players.length);
  playerList.replaceChildren();

  for (const player of room.players) {
    const item = document.createElement("li");
    item.className = "player-list-item";

    // Visually distinguish the host.
    if (player.role === "host") {
      item.classList.add("host-player");
    }

    const presence = document.createElement("span");
    presence.className = "player-presence";
    presence.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.textContent = player.name;
    name.title = player.name;

    const roleBadge = document.createElement("span");
    roleBadge.className = "player-role";

    // The host sees "Tu"; other players see "Izveidotājs".
    roleBadge.textContent =
      player.id === room.selfId
        ? "Tu"
        : player.role === "host"
          ? "Izveidotājs"
          : "Spēlētājs";

    const avatar = document.createElement("span");
    renderAvatar(avatar, player);
    const identity = document.createElement("span");
    identity.className = "room-player-identity";
    identity.append(avatar, name);
    item.append(presence, identity, roleBadge);

    if (isHost && player.role !== "host" && room.status === "waiting") {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-player-button";
      removeButton.setAttribute(
        "aria-label",
        `Izņemt spēlētāju ${player.name}`,
      );

      removeButton.addEventListener("click", () => {
        removePlayer(player.id, player.name);
      });

      item.append(removeButton);
    }

    playerList.append(item);
  }

  renderSettings();

  if (room.status === "waiting") {
    beginButton.textContent =
      room.players.length === 1 ? "Spēlēt pret botu" : "Sākt multiplayer";
    setStatus(
      room.players.length === 1
        ? "Uzaicini citus ar istabas kodu vai sāc spēli pret botu."
        : "Spēlētāji ir gatavi. Izveidotājs var sākt multiplayer spēli.",
    );
  }

  if (room.status === "finished") {
    redirected = true;
    window.clearInterval(refreshTimer);
    setStatus("Istaba ir aizvērta. Atgriežamies sākumlapā...");
    window.location.replace("/");
    return;
  }

  if (room.status === "active") {
    goToMatch();
  }
}

async function refreshRoom() {
  if (redirected || busy || refreshing) return;
  refreshing = true;

  try {
    const data = await api(`/api/rooms/${encodeURIComponent(roomCode)}`);

    // A poll started before a settings save must not undo its result.
    if (redirected || busy || (room && data.room.version < room.version)) return;
    room = data.room;

    // If the host closed the room or the match was finished,
    // send everyone still viewing the waiting room home.
    if (room.status === "finished") {
      redirected = true;
      window.clearInterval(refreshTimer);
      window.location.replace("/");
      return;
    }

    // If the room was destroyed, or this player was removed,
    // stop polling and return to the homepage.
    const stillInRoom = room.players.some(
      (player) => player.id === room.selfId,
    );

    if (!stillInRoom) {
      redirected = true;
      window.clearInterval(refreshTimer);
      window.location.replace("/");
      return;
    }

    renderRoom();
  } catch (error) {
    if (leaving || redirected) return;
    if (error.status === 404) {
      redirected = true;
      window.clearInterval(refreshTimer);
      window.location.replace("/");
      return;
    }

    // A temporary server/network problem should not kick
    // everyone out of a room that may still exist.
    setStatus(error.message);
  } finally {
    refreshing = false;
  }
}

function updateSettings(event) {
  if (leaving || !isHost || (room && room.status !== "waiting")) return;
  // Keep user intent even while creation or another save is in flight.
  if (event.target === allowGuestsInput) {
    pendingSettings.allowGuests = allowGuestsInput.checked;
  } else {
    pendingSettings.timeLimitSeconds = Number(event.target.value);
  }
  settingsRevision += 1;
  renderSettings();
  saveSettings();
}

async function saveSettings() {
  if (!isHost || !room || busy || redirected || room.status !== "waiting" ||
      !hasPendingSettings()) return;

  busy = true;
  renderSettings();
  setStatus("Saglabā istabas iestatījumus...");
  try {
    // Serialize saves; a response to an earlier click cannot replace a later one.
    while (hasPendingSettings()) {
      const revision = settingsRevision;
      const data = await api(
        `/api/rooms/${encodeURIComponent(roomCode)}/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({ playerId, ...pendingSettings }),
        },
      );
      room = data.room;
      if (revision === settingsRevision) pendingSettings = {};
      renderRoom();
    }
    setStatus("Istabas iestatījumi saglabāti.");
  } catch (error) {
    pendingSettings = {};
    setStatus(`Neizdevās saglabāt iestatījumus: ${error.message}`);
  } finally {
    busy = false;
    renderSettings();
  }
}

async function removePlayer(targetId, targetName) {
  if (!isHost || busy || !room || room.status !== "waiting") return;

  if (!confirm(`Vai tiešām izņemt spēlētāju "${targetName}"?`)) {
    return;
  }

  busy = true;

  try {
    const data = await api(
      `/api/rooms/${encodeURIComponent(roomCode)}/players/${encodeURIComponent(targetId)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ playerId }),
      },
    );

    room = data.room;
    renderRoom();
    setStatus(`Spēlētājs "${targetName}" ir izņemts no istabas.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    busy = false;
    renderSettings();
    saveSettings();
  }
}

function goToMatch() {
  if (redirected || !room) return;

  redirected = true;

  const url = new URL("./game-table.html", location.href);
  url.searchParams.set("mode", room.mode);
  url.searchParams.set("code", room.code);
  url.searchParams.set("role", isHost ? "host" : "player");
  url.searchParams.set("name", playerName);
  url.searchParams.set("timeLimit", String(room.timeLimitSeconds));

  location.assign(url);
}

async function startGame() {
  console.log("[Room] Begin Match clicked", {
    isHost,
    roomStatus: room?.status,
    players: room?.players?.length,
    busy,
    roomCode,
  });

  if (!isHost || !room || busy || hasPendingSettings()) {
    console.warn("[Room] Start blocked by preconditions.");
    return;
  }

  if (room.status !== "waiting" || room.players.length < 1) {
    setStatus("Istabā jābūt vismaz vienam spēlētājam.");
    return;
  }

  busy = true;
  beginButton.disabled = true;

  try {
    const data = await api(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    });

    console.log("[Room] Start response:", data);

    room = data.room;
    renderRoom();

    if (room.status !== "active") {
      setStatus("Serveris vēl nav atzīmējis spēli kā sāktu.");
    }
  } catch (error) {
    console.error("[Room] Failed to start match:", error);
    setStatus(error.message);
    beginButton.disabled = false;
  } finally {
    busy = false;
  }
}

async function initializeRoom() {
  if (
    !/^[A-Z0-9]{8}$/.test(roomCode) ||
    !["classic", "passing", "japan"].includes(mode) ||
    !["host", "player"].includes(params.get("role"))
  ) {
    setStatus("Nederīga istabas saite vai istabas kods.");
    return;
  }

  const handoff = params.get("handoff");
  const initialRoom = takeRoomHandoff(roomCode, handoff);
  if (handoff) {
    const url = new URL(location.href);
    url.searchParams.delete("handoff");
    history.replaceState(history.state, "", url);
  }
  if (initialRoom) {
    room = initialRoom;
    renderRoom();
    if (!redirected) refreshTimer = window.setInterval(refreshRoom, 2000);
    return;
  }

  await loadPlayerName();

  try {
    if (isHost) {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          code: roomCode,
          mode,
          playerId,
          name: playerName,
          allowGuests: allowGuestsInput.checked,
        }),
      });

      room = data.room;
    } else {
      const data = await api(
        `/api/rooms/${encodeURIComponent(roomCode)}/join`,
        {
          method: "POST",
          body: JSON.stringify({
            playerId,
            name: playerName,
          }),
        },
      );

      room = data.room;
    }

    renderRoom();
    await saveSettings();
    if (!redirected) refreshTimer = window.setInterval(refreshRoom, 2000);
  } catch (error) {
    console.error("Failed to initialize room:", error);

    if (
      error.code === "GUESTS_NOT_ALLOWED" ||
      (error.status === 403 &&
        error.message.includes("viesi bez konta nav atļauti"))
    ) {
      redirected = true;

      alert(
        "Šajā istabā viesi bez konta nav atļauti. Lūdzu, piesakieties vai izvēlieties citu istabu.",
      );

      window.location.replace("/");
      return;
    }

    setStatus(isHost
      ? `Kods ${roomCode} ir ģenerēts, bet istabu serverī neizdevās izveidot: ${error.message}`
      : error.message);
  }
}

async function leaveRoom() {
  if (redirected || leaving) return;
  if (!roomCode || !playerId || (!room && !initializing)) {
    window.location.replace("/");
    return;
  }
  if (!room || busy) {
    setStatus("Uzgaidi, līdz pabeigta pašreizējā istabas darbība, un mēģini vēlreiz.");
    return;
  }

  if (queueRoomExit(room)) {
    redirected = true;
    leaving = true;
    window.clearInterval(refreshTimer);
    window.location.replace(new URL("./index.html", location.href));
    return;
  }

  // If browser storage is unavailable, retain the confirmed-exit fallback.
  leaving = true;
  busy = true;
  const link = document.querySelector("#leave-room");
  const originalText = link.textContent;
  link.textContent = "Iziet no istabas…";
  link.setAttribute("aria-disabled", "true");
  renderSettings();
  setStatus("Iziet no istabas…");
  const goHome = () => {
    redirected = true;
    window.clearInterval(refreshTimer);
    window.location.replace("/");
  };
  try {
    await api(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
      method: "POST",
      body: JSON.stringify({ playerId, membershipId: room.selfId }),
    });
    goHome();
  } catch (error) {
    if (error.status === 404) {
      goHome();
      return;
    }
    console.error("Failed to leave room:", error);
    setStatus(`Neizdevās pamest istabu: ${error.message} Mēģini vēlreiz.`);
  } finally {
    if (!redirected) {
      leaving = false;
      busy = false;
      link.textContent = originalText;
      link.removeAttribute("aria-disabled");
      renderSettings();
    }
  }
}

document.querySelector("#leave-room")?.addEventListener("click", (event) => {
  event.preventDefault();
  leaveRoom();
});

let refreshTimer = null;

timeLimitInputs.forEach((input) => {
  input.addEventListener("change", updateSettings);
});

allowGuestsInput.addEventListener("change", updateSettings);
beginButton.addEventListener("click", startGame);
copyCodeButton.addEventListener("click", copyRoomCode);

renderSettings();
initializeRoom().finally(() => { initializing = false; });
