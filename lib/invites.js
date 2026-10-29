import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { GameError } from "./multiplayer.js";

// Pending friend invitations to waiting rooms, kept in this process like the
// game sockets that deliver them. Each page of a signed-in user (except the
// game table) subscribes over Socket.IO, so "connected" means the friend has
// the site open and can see the notification.
export function createInvites({ ttlMs = 2 * 60 * 1000 } = {}) {
  const events = new EventEmitter();
  const pending = new Map();
  const sockets = new Map();

  function prune(now) {
    for (const [id, invite] of pending) if (invite.expiresAt <= now) pending.delete(id);
  }
  function connect(userId, socketId) {
    const key = String(userId);
    if (!sockets.has(key)) sockets.set(key, new Set());
    sockets.get(key).add(socketId);
  }
  function disconnect(userId, socketId) {
    const key = String(userId);
    sockets.get(key)?.delete(socketId);
    if (!sockets.get(key)?.size) sockets.delete(key);
  }
  function isConnected(userId) {
    return sockets.has(String(userId));
  }
  function forUser(userId, now = Date.now()) {
    prune(now);
    return [...pending.values()].filter((invite) => invite.toUserId === String(userId));
  }
  function create({ roomCode, mode, fromUserId, fromName, toUserId, toName }, now = Date.now()) {
    prune(now);
    const duplicate = [...pending.values()].some((invite) =>
      invite.roomCode === roomCode && invite.toUserId === String(toUserId));
    if (duplicate) throw new GameError("Šim draugam ielūgums jau ir nosūtīts.");
    const invite = {
      id: randomBytes(12).toString("hex"),
      roomCode, mode, fromName, toName,
      fromUserId: String(fromUserId),
      toUserId: String(toUserId),
      expiresAt: now + ttlMs,
    };
    pending.set(invite.id, invite);
    events.emit("received", invite);
    return invite;
  }
  // Removes the invitation so a second tab or click cannot answer it again.
  function take(id, userId, now = Date.now()) {
    prune(now);
    const invite = pending.get(id);
    if (!invite || invite.toUserId !== String(userId))
      throw new GameError("Ielūgums vairs nav spēkā.", 404);
    pending.delete(id);
    events.emit("closed", invite);
    return invite;
  }
  function reject(id, userId, now = Date.now()) {
    const invite = take(id, userId, now);
    events.emit("rejected", invite);
    return invite;
  }
  return { events, connect, disconnect, isConnected, forUser, create, take, reject };
}

export function publicInvite(invite, now = Date.now()) {
  return {
    id: invite.id,
    roomCode: invite.roomCode,
    mode: invite.mode,
    fromName: invite.fromName,
    expiresInMs: Math.max(0, invite.expiresAt - now),
  };
}
