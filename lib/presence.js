// Last request time per session (hashed token), kept in this process like the
// login limiter. Every page sends a heartbeat while open, so a session is
// online until its tabs have been closed for windowMs. Logging out or a ban
// deletes the session, which takes the user offline immediately.
export function createPresence({ windowMs = 3 * 60 * 1000 } = {}) {
  const lastSeen = new Map();
  return {
    touch(tokenHash, now = Date.now()) {
      lastSeen.set(tokenHash, now);
      if (lastSeen.size > 10000) {
        for (const [key, seenAt] of lastSeen) if (now - seenAt >= windowMs) lastSeen.delete(key);
      }
    },
    isOnline(tokenHash, now = Date.now()) {
      const seenAt = lastSeen.get(tokenHash);
      return seenAt !== undefined && now - seenAt < windowMs;
    },
  };
}
