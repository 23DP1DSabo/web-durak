const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
  duraklash: "DuraKlash",
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
    sessionStorage.setItem(`durak-room:${code}`, JSON.stringify({
      code,
      mode: selectedMode,
      timeLimitSeconds: 600,
      status: "waiting",
      createdAt: Date.now(),
      players: [],
    }));
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
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Neizdevās pārbaudīt istabu.");
  }

  return data;
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = new Uint8Array(8);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
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
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
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