// Persist the intent before navigation; the home page owns the request and UI.
const storageKey = "durak-pending-room-exit";
let inFlight = null;

export function queueRoomExit(room) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ code: room.code, membershipId: room.selfId }));
    return true;
  } catch {
    return false;
  }
}

function pendingExit() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey));
    return /^[A-Z0-9]{8}$/.test(value?.code) && typeof value.membershipId === "string" ? value : null;
  } catch {
    return null;
  }
}

function showExitStatus(message, failed = false) {
  const notice = document.querySelector("#room-exit-notice");
  if (!notice) return;
  notice.hidden = !message;
  document.querySelector("#room-exit-message").textContent = message;
  document.querySelector("#retry-room-exit").hidden = !failed;
}

export function finishRoomExit() {
  if (inFlight) return inFlight;
  const pending = pendingExit();
  if (!pending) return Promise.resolve();
  inFlight = (async () => {
    showExitStatus("Pabeidz iziešanu no istabas…");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(pending.code)}/leave`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: pending.membershipId }),
        keepalive: true,
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => ({}));
      // Reload/retry can follow a committed response that never reached us.
      if (!response.ok && response.status !== 404 && data.code !== "NOT_ROOM_MEMBER") {
        throw new Error(data.error || "Serveris pašlaik nav sasniedzams.");
      }
      sessionStorage.removeItem(storageKey);
      showExitStatus("");
    } catch (error) {
      showExitStatus("Neizdevās pabeigt iziešanu no istabas. Mēģini vēlreiz.", true);
      throw error;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function initializeRoomExit() {
  const resume = () => { finishRoomExit().catch(() => {}); };
  document.querySelector("#retry-room-exit")?.addEventListener("click", resume);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", resume);
  resume();
}
