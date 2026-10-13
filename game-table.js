const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
  duraklash: "DuraKlash",
};

const parameters = new URLSearchParams(window.location.search);
const roomCode = parameters.get("code")?.toUpperCase() ?? "";
let roomState;
try {
  roomState = JSON.parse(sessionStorage.getItem(`durak-room:${roomCode}`) ?? "null");
} catch {
  roomState = null;
}

const mode = roomState?.mode ?? parameters.get("mode") ?? "classic";
const playerName = parameters.get("name") ?? "Spēlētājs";
const role = parameters.get("role") ?? "player";
const timeLimit = String(roomState?.timeLimitSeconds ?? parameters.get("timeLimit") ?? "600");
const validTimeLimits = new Set(["60", "180", "300", "600"]);

if (!/^[A-Z0-9]{8}$/.test(roomCode) || !validTimeLimits.has(timeLimit)) {
  window.location.replace("./index.html");
} else {
  document.querySelector("#match-mode").textContent = modeNames[mode] ?? "Spēle";
  document.querySelector("#match-code").textContent = roomCode;
  document.querySelector("#match-time-limit").textContent = `${Number(timeLimit) / 60} min katram`;
  document.querySelector("#match-player-name").textContent = playerName;
  document.querySelector(".player-avatar").textContent = playerName.trim().charAt(0).toUpperCase() || "D";

  document.querySelectorAll(".hand-card").forEach((card) => {
    card.addEventListener("click", () => {
      const selected = card.getAttribute("aria-pressed") === "true";
      card.setAttribute("aria-pressed", String(!selected));
    });
  });

  if (roomState) {
    roomState.status = "active";
    sessionStorage.setItem(`durak-room:${roomCode}`, JSON.stringify(roomState));
  }

  const returnUrl = new URL("./room.html", window.location.href);
  returnUrl.searchParams.set("mode", mode);
  returnUrl.searchParams.set("code", roomCode);
  returnUrl.searchParams.set("role", role);
  document.querySelector("#return-to-room").href = returnUrl;
}