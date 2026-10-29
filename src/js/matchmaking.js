import { finishRoomExit, initializeRoomExit } from "./room-exit.js";
import { storeRoomHandoff } from "./room-handoff.js";
import { showAlert } from "./dialogs.js";

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
let enteringRoom = false;
let pendingRoomCode = null;
let resetEntry = null;

const menuToggle = document.querySelector("#frontpage-menu-toggle");
const navigationMenu = document.querySelector("#side-navigation-menu");
const mobileNavigation = window.matchMedia("(max-width: 700px)");

if (menuToggle && navigationMenu) {
  function setNavigationOpen(isOpen, restoreFocus = false) {
    const shouldOpen = mobileNavigation.matches && isOpen;

    menuToggle.setAttribute("aria-expanded", String(shouldOpen));
    menuToggle.setAttribute(
      "aria-label",
      shouldOpen ? "Aizvērt navigāciju" : "Atvērt navigāciju",
    );
    navigationMenu.setAttribute("aria-hidden", String(mobileNavigation.matches && !shouldOpen));
    navigationMenu.inert = mobileNavigation.matches && !shouldOpen;
    document.querySelector("#frontpage-content").classList.toggle("mobile-nav-open", shouldOpen);

    if (restoreFocus && !shouldOpen) menuToggle.focus();
  }

  setNavigationOpen(false);

  menuToggle.addEventListener("click", () => {
    setNavigationOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  });

  navigationMenu.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) setNavigationOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (
      menuToggle.getAttribute("aria-expanded") === "true" &&
      !navigationMenu.contains(event.target) &&
      !menuToggle.contains(event.target)
    ) {
      setNavigationOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
      setNavigationOpen(false, true);
    }
  });

  mobileNavigation.addEventListener("change", () => setNavigationOpen(false));
}

function openRoomPage(room, role) {
  const roomUrl = new URL("./room.html", window.location.href);
  roomUrl.searchParams.set("mode", room.mode);
  roomUrl.searchParams.set("code", room.code);
  roomUrl.searchParams.set("role", role);
  const handoff = storeRoomHandoff(room);
  if (handoff) roomUrl.searchParams.set("handoff", handoff);
  window.location.assign(roomUrl);
}

async function enterRoom(path, body, button, label, onError) {
  if (enteringRoom) return;
  enteringRoom = true;
  const originalText = button.textContent;
  resetEntry = () => {
    enteringRoom = false;
    button.disabled = false;
    button.textContent = originalText;
    resetEntry = null;
  };
  button.disabled = true;
  button.textContent = label;
  try {
    // Do not join/create another room until the previous membership is cleared.
    await finishRoomExit();
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, playerId: getPlayerId(), name: await getQuickplayPlayerName() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Neizdevās atvērt istabu. Mēģini vēlreiz.");
    openRoomPage(data.room, data.room.selfId === data.room.hostId ? "host" : "player");
  } catch (error) {
    resetEntry?.();
    onError(error);
  }
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

function quickplay(mode, button) {
  return enterRoom("/api/rooms/quickplay", { mode }, button, "Meklē istabu...", (error) => showAlert(error.message));
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
    if (enteringRoom) return;
    selectedMode = button.dataset.roomMode;
    pendingRoomCode = null;
    document.querySelector("#create-room-message").hidden = true;
    roomModeLabel.textContent = modeNames[selectedMode] ?? "Spēle";
    roomChoiceActions.hidden = false;
    joinRoomForm.hidden = true;
    joinRoomMessage.hidden = true;
    roomCodeInput.value = "";
    roomDialog.showModal();
  });
});

roomDialog.addEventListener("cancel", (event) => {
  if (enteringRoom) event.preventDefault();
});

roomDialog.addEventListener("click", (event) => {
  const action = event.target.closest("[data-room-action]")?.dataset.roomAction;
  if (!action || enteringRoom) return;

  if (action === "create") {
    const button = event.target.closest("[data-room-action]");
    const message = document.querySelector("#create-room-message");
    message.hidden = true;
    enterRoom("/api/rooms", { code: pendingRoomCode ??= createRoomCode(), mode: selectedMode }, button, "Veido istabu...", (error) => {
      message.textContent = error.message;
      message.hidden = false;
    });
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

  if (enteringRoom) return;
  joinRoomMessage.textContent = "Pievienojas istabai...";
  joinRoomMessage.hidden = false;
  await enterRoom(`/api/rooms/${encodeURIComponent(code)}/join`, {},
    joinRoomForm.querySelector('[type="submit"]'), "Pievienojas...", (error) => {
      joinRoomMessage.textContent = error.message;
      joinRoomMessage.hidden = false;
    });
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

// A back/forward-cache restore keeps JS state, including the navigation lock.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    resetEntry?.();
    pendingRoomCode = null;
  }
});

initializeRoomExit();
