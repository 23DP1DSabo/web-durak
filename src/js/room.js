const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
  duraklash: "DuraKlash",
};

const parameters = new URLSearchParams(window.location.search);
const roomCode = parameters.get("code")?.toUpperCase() ?? "";
const mode = parameters.get("mode") ?? "classic";
const role = parameters.get("role") ?? "player";
const roomStorageKey = `durak-room:${roomCode}`;
const timeLimitInputs = document.querySelectorAll('input[name="time-limit"]');
const timeLimitStatus = document.querySelector("#time-limit-status");

function readRoomState() {
  try {
    return JSON.parse(sessionStorage.getItem(roomStorageKey) ?? "null");
  } catch {
    return null;
  }
}

let roomState = readRoomState();

function getGuestName() {
  const storageKey = "durak-guest-name";
  const existingName = sessionStorage.getItem(storageKey);
  if (existingName) return existingName;

  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
  const guestName = `Guest${String(digits).padStart(5, "0")}`;
  sessionStorage.setItem(storageKey, guestName);
  return guestName;
}

function updateTimeLimit(seconds) {
  const minutes = Number(seconds) / 60;
  const label = `${minutes} min`;
  timeLimitStatus.textContent = `Katram spēlētājam: ${label}`;
  sessionStorage.setItem(`durak-room-time-limit:${roomCode}`, String(seconds));
  roomState = { ...roomState, code: roomCode, mode, timeLimitSeconds: Number(seconds), status: "waiting" };
  sessionStorage.setItem(roomStorageKey, JSON.stringify(roomState));
}

async function showPlayerName() {
  let name = getGuestName();
  const playerName = document.querySelector("#player-name");
  roomState = {
    ...roomState,
    code: roomCode,
    mode,
    players: [{ name, role }],
  };
  sessionStorage.setItem(roomStorageKey, JSON.stringify(roomState));
  const playerRole = document.querySelector("#player-role");
  playerName.textContent = name;
  playerRole.textContent = role === "host" ? "Izveidotājs" : "Tu";

  try {
    const response = await fetch("/api/auth/me");
    if (response.ok) {
      const result = await response.json();
      name = result.user.name || result.user.email || "Konts";
      playerName.textContent = name;
    }
  } catch {
    // Keep the guest name when the auth service is unavailable.
  }
}

if (!/^[A-Z0-9]{8}$/.test(roomCode)) {
  window.location.replace("./index.html");
} else {
  document.querySelector("#room-mode-name").textContent = modeNames[mode] ?? "Spēle";
  document.querySelector("#room-code").textContent = roomCode;

  roomState ??= { code: roomCode, mode, timeLimitSeconds: 600, status: "waiting", players: [] };
  const savedTimeLimit = sessionStorage.getItem(`durak-room-time-limit:${roomCode}`)
    ?? String(roomState.timeLimitSeconds ?? 600);
  const selectedTimeLimit = [...timeLimitInputs].find((input) => input.value === savedTimeLimit);
  if (selectedTimeLimit) selectedTimeLimit.checked = true;
  updateTimeLimit(selectedTimeLimit?.value ?? "600");

  timeLimitInputs.forEach((input) => {
    input.addEventListener("change", () => updateTimeLimit(input.value));
  });

  document.querySelector("#begin-match").addEventListener("click", () => {
    const playerName = document.querySelector("#player-name").textContent;
    const currentTimeLimit = document.querySelector('input[name="time-limit"]:checked')?.value ?? "600";
    roomState = {
      ...roomState,
      code: roomCode,
      mode,
      timeLimitSeconds: Number(currentTimeLimit),
      status: "active",
      players: [{ name: playerName, role }],
      startedAt: Date.now(),
    };
    sessionStorage.setItem(roomStorageKey, JSON.stringify(roomState));

    const matchUrl = new URL("./game-table.html", window.location.href);
    matchUrl.searchParams.set("mode", mode);
    matchUrl.searchParams.set("code", roomCode);
    matchUrl.searchParams.set("role", role);
    matchUrl.searchParams.set("name", playerName);
    matchUrl.searchParams.set("timeLimit", currentTimeLimit);
    window.location.assign(matchUrl);
  });

  showPlayerName();
}