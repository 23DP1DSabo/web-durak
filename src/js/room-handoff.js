// Transfer one fresh server response across navigation, never a long-lived cache.
const key = "durak-room-handoff";

export function storeRoomHandoff(room) {
  try {
    const token = crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ token, room, expiresAt: Date.now() + 30000 }));
    return token;
  } catch {
    // Storage may be disabled; the room page can still initialize via the API.
    return null;
  }
}

export function takeRoomHandoff(code, token) {
  if (!token) return null;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const saved = JSON.parse(raw);
    const room = saved?.room;
    if (saved?.token !== token || saved.expiresAt <= Date.now() ||
        !Number.isFinite(saved.expiresAt) || room?.code !== code ||
        !["classic", "passing", "japan"].includes(room.mode) ||
        !["waiting", "active", "finished"].includes(room.status) ||
        !Number.isInteger(room.version) || !room.selfId ||
        !Array.isArray(room.players) || !room.players.some((p) => p.id === room.selfId)) return null;
    return room;
  } catch {
    return null;
  }
}
