import { io } from "socket.io-client";
import { fetchCurrentUser } from "./current-user.js";
import { storeRoomHandoff } from "./room-handoff.js";

// Friend invitations arrive over Socket.IO on every page except the game
// table, where players are busy. The server only sends them to friends who
// have the site open and are not in a game.
const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
};
const container = document.createElement("div");
container.className = "invite-toasts";

function removeToast(id) {
  container.querySelector(`[data-invite-id="${CSS.escape(id)}"]`)?.remove();
}

function toast(lines, { id = null, error = false, actions = [], timeoutMs = 8000 } = {}) {
  const element = document.createElement("section");
  element.className = `invite-toast${error ? " invite-toast-error" : ""}`;
  element.setAttribute("role", actions.length ? "alertdialog" : "status");
  if (id) element.dataset.inviteId = id;
  const text = document.createElement("div");
  text.className = "invite-toast-text";
  for (const line of lines) {
    const paragraph = document.createElement("p");
    paragraph.append(...line);
    text.append(paragraph);
  }
  const buttons = document.createElement("div");
  buttons.className = "invite-toast-actions";
  for (const [label, onClick, className] of actions.length ? actions : [["Aizvērt", () => element.remove()]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener("click", () => onClick(element, buttons));
    buttons.append(button);
  }
  element.append(text, buttons);
  container.append(element);
  setTimeout(() => element.remove(), timeoutMs);
  return element;
}

function showError(element, message) {
  element.classList.add("invite-toast-error");
  element.setAttribute("role", "status");
  const text = element.querySelector(".invite-toast-text");
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  text.replaceChildren(paragraph);
  element.querySelector(".invite-toast-actions").remove();
  setTimeout(() => element.remove(), 6000);
}

async function answer(invite, decision) {
  const response = await fetch(`/api/rooms/invites/${encodeURIComponent(invite.id)}/${decision}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Neizdevās atbildēt uz ielūgumu.");
  return data;
}

function showInvite(invite) {
  if (container.querySelector(`[data-invite-id="${CSS.escape(invite.id)}"]`)) return;
  const from = document.createElement("strong");
  from.textContent = invite.fromName;
  const respond = (decision) => async (element, buttons) => {
    for (const button of buttons.children) button.disabled = true;
    try {
      const data = await answer(invite, decision);
      if (decision === "reject") return element.remove();
      const url = new URL("./room.html", location.href);
      url.search = "";
      url.searchParams.set("mode", data.room.mode);
      url.searchParams.set("code", data.room.code);
      url.searchParams.set("role", "player");
      const handoff = storeRoomHandoff(data.room);
      if (handoff) url.searchParams.set("handoff", handoff);
      location.assign(url);
    } catch (error) {
      showError(element, error.message);
    }
  };
  toast([
    [from, " ielūdz tevi spēlēt"],
    [`${modeNames[invite.mode] ?? invite.mode} · istaba ${invite.roomCode}`],
  ], {
    id: invite.id,
    timeoutMs: invite.expiresInMs,
    actions: [
      ["Noraidīt", respond("reject")],
      ["Pieņemt", respond("accept"), "invite-toast-accept"],
    ],
  });
}

async function start() {
  try {
    if (!(await fetchCurrentUser()).ok) return;
  } catch {
    return;
  }
  document.body.append(container);
  const socket = io();
  // A reconnect gets a new socket ID, so subscribe again on every connect.
  socket.on("connect", async () => {
    try {
      const data = await socket.timeout(10000).emitWithAck("invites:subscribe", {});
      for (const invite of data.invites ?? []) showInvite(invite);
    } catch { /* The next reconnect subscribes again. */ }
  });
  socket.on("invite:received", showInvite);
  socket.on("invite:closed", ({ id }) => removeToast(id));
  socket.on("invite:rejected", ({ toName }) => {
    const name = document.createElement("strong");
    name.textContent = toName;
    toast([[name, " noraidīja tavu ielūgumu."]], { error: true });
  });
}

void start();
