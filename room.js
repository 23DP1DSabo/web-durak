const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
  duraklash: "DuraKlash",
};

const parameters = new URLSearchParams(window.location.search);
const roomCode = parameters.get("code")?.toUpperCase() ?? "";
const mode = parameters.get("mode") ?? "classic";

if (!/^[A-Z0-9]{8}$/.test(roomCode)) {
  window.location.replace("./index.html");
} else {
  document.querySelector("#room-mode-name").textContent = modeNames[mode] ?? "Spēle";
  document.querySelector("#room-code").textContent = roomCode;
}