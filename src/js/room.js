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

let room = null;
let playerName = "Viesis";
let busy = false;
let redirected = false;

let playerId = localStorage.getItem("durak-player-id");
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("durak-player-id", playerId);
}

if (/^[A-Z0-9]{8}$/.test(roomCode)) {
  roomCodeElement.textContent = roomCode;
}

function setStatus(message) {
  statusElement.textContent = message;
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
  if (!room) return;
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

    const roleBadge = document.createElement("span");
    roleBadge.className = "player-role";

    // The host sees "Tu"; other players see "Izveidotājs".
    roleBadge.textContent =
      player.id === room.selfId
        ? "Tu"
        : player.role === "host"
          ? "Izveidotājs"
          : "Spēlētājs";

    item.append(presence, name, roleBadge);

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

  for (const input of timeLimitInputs) {
    input.checked = Number(input.value) === room.timeLimitSeconds;
    input.disabled = !isHost || room.status !== "waiting";
  }

  timeLimitStatus.textContent = `Katram spēlētājam: ${room.timeLimitSeconds / 60} min`;

  allowGuestsInput.checked = room.allowGuests;
  allowGuestsInput.disabled = !isHost || room.status !== "waiting";

  beginButton.hidden = !isHost;
  beginButton.disabled =
    !isHost || room.status !== "waiting" || room.players.length < 1;

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
  if (redirected || busy) return;

  try {
    const data = await api(`/api/rooms/${encodeURIComponent(roomCode)}`);

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
    if (error.status === 404) {
      redirected = true;
      window.clearInterval(refreshTimer);
      window.location.replace("/");
      return;
    }

    // A temporary server/network problem should not kick
    // everyone out of a room that may still exist.
    setStatus(error.message);
  }
}

async function updateSettings() {
  if (!isHost || !room || busy) return;

  busy = true;

  try {
    const selected = document.querySelector('input[name="time-limit"]:checked');

    const data = await api(
      `/api/rooms/${encodeURIComponent(roomCode)}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({
          playerId,
          timeLimitSeconds: Number(selected?.value ?? room.timeLimitSeconds),
          allowGuests: allowGuestsInput.checked,
        }),
      },
    );

    room = data.room;
    renderRoom();
    setStatus("Istabas iestatījumi saglabāti.");
  } catch (error) {
    setStatus(error.message);
    await refreshRoom();
  } finally {
    busy = false;
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

  if (!isHost || !room || busy) {
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
    refreshTimer = window.setInterval(refreshRoom, 2000);
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
  if (!roomCode || !playerId || redirected) {
    window.location.replace("/");
    return;
  }

  try {
    await api(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    });

    redirected = true;
    window.clearInterval(refreshTimer);
    window.location.replace("/");
  } catch (error) {
    console.error("Failed to leave room:", error);
    setStatus(`Neizdevās pamest istabu: ${error.message}`);
    redirected = true;
    window.clearInterval(refreshTimer);
    window.location.replace("/");
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

initializeRoom();
