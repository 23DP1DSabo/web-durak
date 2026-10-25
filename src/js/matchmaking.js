const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
};

const roomDialog = document.querySelector("#room-choice-dialog");
const roomModeLabel = document.querySelector("#room-dialog-mode");
const roomChoiceActions = document.querySelector("#room-choice-actions");
const joinRoomForm = document.querySelector("#join-room-form");
const roomCodeInput = document.querySelector("#room-code-input");
const joinRoomMessage = document.querySelector("#join-room-message");
let selectedMode = "classic";

function openRoomPage(code, role) {
  if (role === "host") {
    sessionStorage.setItem(
      `durak-room:${code}`,
      JSON.stringify({
        code,
        mode: selectedMode,
        timeLimitSeconds: 600,
        status: "waiting",
        createdAt: Date.now(),
        players: [],
      }),
    );
  }

  const roomUrl = new URL("./room.html", window.location.href);
  roomUrl.searchParams.set("mode", selectedMode);
  roomUrl.searchParams.set("code", code);
  roomUrl.searchParams.set("role", role);
  window.location.assign(roomUrl);
}

async function checkRoomAccess(code) {
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(code)}/access`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Neizdevās pārbaudīt istabu.");
  }

  return data;
}

function getPlayerId() {
  let playerId = localStorage.getItem("durak-player-id");

  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem("durak-player-id", playerId);
  }

  return playerId;
}

async function getQuickplayPlayerName() {
  let name = sessionStorage.getItem("durak-guest-name");

  if (!name) {
    const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;

    name = `Viesis${String(digits).padStart(5, "0")}`;
    sessionStorage.setItem("durak-guest-name", name);
  }

  // The server chooses the authenticated account name from the session.

  return name;
}

async function quickplay(mode, button) {
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Meklē istabu...";

  try {
    const name = await getQuickplayPlayerName();

    const response = await fetch("/api/rooms/quickplay", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        mode,
        playerId: getPlayerId(),
        name,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Neizdevās atrast spēles istabu.");
    }

    // Navigate using the room code returned by the server.
    selectedMode = data.room.mode;
    openRoomPage(data.room.code, "player");
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = new Uint8Array(8);
  crypto.getRandomValues(randomValues);
  return Array.from(
    randomValues,
    (value) => alphabet[value % alphabet.length],
  ).join("");
}


function finish(g, loser, reason) {
  g.result = {
    loser,
    winners: g.players
      .filter((p) => p.id !== loser)
      .map((p) => p.id),
    reason,
  };
  g.phase = "finished";
}

function eliminate(g, id, reason) {
  const p = player(g, id);

  if (!p || p.out) return;

  p.out = true;

  // end game when there is one or less active players
  const remaining = active(g);

  if (remaining.length <= 1) {
    finish(g, id, reason);
    return;
  }

  // if the removed player was in an active phase
  // clear the attack and continue with the other players
  if (g.attacker === id || g.defender === id) {
    g.discard.push(
      ...g.attacks,
      ...g.defenses.filter(Boolean),
    );

    g.attacks = [];
    g.defenses = [];
    g.limit = 0;
    g.attacker = next(g, id);
    g.defender = next(g, g.attacker);
    g.phase = "attack";
  }
}

export function advanceClock(g, now = Date.now()) {
  if (g.result) return false;

  const currentActor = actor(g);
  if (!currentActor) return false;

  const p = player(g, currentActor);

  if (!p || p.out) return false;

  p.remainingMs = Math.max(
    0,
    p.remainingMs - Math.max(0, now - g.updatedAt),
  );

  g.updatedAt = now;

  if (p.remainingMs === 0) {
    eliminate(g, p.id, "timeout");
    return true;
  }

  return false;
}

document.querySelectorAll("[data-room-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedMode = button.dataset.roomMode;
    roomModeLabel.textContent = modeNames[selectedMode] ?? "Spēle";
    roomChoiceActions.hidden = false;
    joinRoomForm.hidden = true;
    joinRoomMessage.hidden = true;
    roomCodeInput.value = "";
    roomDialog.showModal();
  });
});

roomDialog.addEventListener("click", (event) => {
  const action = event.target.closest("[data-room-action]")?.dataset.roomAction;
  if (!action) return;

  if (action === "create") {
    openRoomPage(createRoomCode(), "host");
  } else if (action === "show-join") {
    roomChoiceActions.hidden = true;
    joinRoomForm.hidden = false;
    roomCodeInput.focus();
  } else if (action === "back") {
    joinRoomForm.hidden = true;
    roomChoiceActions.hidden = false;
    joinRoomMessage.hidden = true;
  } else {
    roomDialog.close();
  }
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  joinRoomMessage.hidden = true;
});

joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const code = roomCodeInput.value.trim().toUpperCase();

  if (!/^[A-Z0-9]{8}$/.test(code)) {
    joinRoomMessage.textContent =
      "Ievadi derīgu 8 simbolu kodu, izmantojot burtus un ciparus.";
    joinRoomMessage.hidden = false;
    roomCodeInput.focus();
    return;
  }

  joinRoomForm.querySelector('[type="submit"]').disabled = true;
  joinRoomMessage.textContent = "Pārbauda istabu...";
  joinRoomMessage.hidden = false;

  try {
    await checkRoomAccess(code);

    // Navigate only after the server confirms access.
    openRoomPage(code, "player");
  } catch (error) {
    joinRoomMessage.textContent = error.message;
    joinRoomMessage.hidden = false;
  } finally {
    const submitButton = joinRoomForm.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = false;
  }
});

const quickplayButtons = {
  "quick-game-classic": "classic",
  "quick-game-passing": "passing",
  "quick-game-japan": "japan",
};

for (const [buttonId, mode] of Object.entries(quickplayButtons)) {
  const button = document.getElementById(buttonId);

  button?.addEventListener("click", () => {
    quickplay(mode, button);
  });
}
