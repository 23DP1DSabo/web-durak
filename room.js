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
const timeLimitInputs = document.querySelectorAll('input[name="time-limit"]');
const timeLimitStatus = document.querySelector("#time-limit-status");

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
}

async function showPlayerName() {
  let name = getGuestName();

  try {
    const response = await fetch("/api/auth/me");
    if (response.ok) {
      const result = await response.json();
      name = result.user.name || result.user.email || "Konts";
    }
  } catch {
    // Keep the guest name when the auth service is unavailable.
  }

  document.querySelector("#player-name").textContent = name;
  document.querySelector("#player-role").textContent = role === "host" ? "Izveidotājs" : "Tu";
}

if (!/^[A-Z0-9]{8}$/.test(roomCode)) {
  window.location.replace("./index.html");
} else {
  document.querySelector("#room-mode-name").textContent = modeNames[mode] ?? "Spēle";
  document.querySelector("#room-code").textContent = roomCode;

  const savedTimeLimit = sessionStorage.getItem(`durak-room-time-limit:${roomCode}`) ?? "600";
  const selectedTimeLimit = [...timeLimitInputs].find((input) => input.value === savedTimeLimit);
  if (selectedTimeLimit) selectedTimeLimit.checked = true;
  updateTimeLimit(selectedTimeLimit?.value ?? "600");

  timeLimitInputs.forEach((input) => {
    input.addEventListener("change", () => updateTimeLimit(input.value));
  });

  showPlayerName();
}