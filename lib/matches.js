import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  GameError,
  applyMove,
  advanceClock,
  privateView,
} from "./multiplayer.js";

const include = {
  players: { orderBy: { id: "asc" }, include: { user: true } },
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cookie = (req, name) =>
  req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
export const nameOf = (p) =>
  p.user?.username || p.user?.name || p.guestName || "Viesis";
export const member = (room, identity) =>
  room.players.find(
    (p) =>
      (identity.user && p.userId === identity.user.id) ||
      (p.userId === null && identity.key && p.playerKey === identity.key),
  );
const requireMember = (room, identity) => {
  const p = member(room, identity);
  if (!p) throw new GameError("Tu neesi šīs istabas dalībnieks.", 403);
  return p;
};
export function publicRoom(room, identity) {
  return {
    code: room.roomCode,
    mode: room.mode,
    status: room.status.toLowerCase(),
    timeLimitSeconds: room.timeLimitSeconds,
    allowGuests: room.allowGuests,
    startedAt: room.startedAt,
    multiplayer: Boolean(room.gameState),
    version: room.version,
    selfId: member(room, identity)?.id.toString() ?? null,
    hostId: room.players[0]?.id.toString() ?? null,
    players: room.players.map((p, i) => ({
      id: String(p.id),
      name: nameOf(p),
      role: i === 0 ? "host" : "player",
      isGuest: p.userId === null,
    })),
  };
}
export function createMatchService(prisma) {
  const events = new EventEmitter();
  async function identity(req, res) {
    const token = cookie(req, "durak_session");
    let user = null;
    if (/^[a-f0-9]{64}$/.test(token || "")) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hash(token) },
        include: { user: true },
      });
      if (
        !session ||
        session.expiresAt <= new Date() ||
        session.user.status !== "ACTIVE"
      ) {
        throw new GameError("Sesija ir beigusies. Pieslēdzies vēlreiz.", 401);
      }
      user = session.user;
    }
    let guest = cookie(req, "durak_guest");
    if (!/^[a-f0-9]{64}$/.test(guest || "")) {
      guest = null;
      if (res) {
        guest = randomBytes(32).toString("hex");
        res.append(
          "Set-Cookie",
          `durak_guest=${guest}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        );
      }
    }
    return { user, key: guest ? hash(guest) : null };
  }
  async function load(code, db = prisma) {
    if (typeof code !== "string" || !/^[A-Z0-9]{8}$/.test(code))
      throw new GameError("Nederīgs istabas kods.", 400);
    const room = await db.match.findUnique({
      where: { roomCode: code },
      include,
    });
    if (!room) throw new GameError("Istaba nav atrasta.", 404);
    return room;
  }
  async function edit(code, callback) {
    const room = await prisma.$transaction(
      async (db) => {
        const room = await load(code, db);
        const patch = await callback(room, db);
        // Membership writes and this compare-and-swap share the transaction:
        // a concurrent change rolls everything back, including inserted players.
        const claimed = await db.match.updateMany({
          where: { id: room.id, version: room.version },
          data: { ...patch, version: { increment: 1 } },
        });
        if (!claimed.count)
          throw new GameError("Istaba mainījās. Mēģini vēlreiz.");
        // Setting changes don't alter membership, so there is nothing to reload.
        return patch
          ? { ...room, ...patch, version: room.version + 1 }
          : load(code, db);
      },
      { timeout: 15000 },
    );
    events.emit("changed", code, room);
    return room;
  }
  async function commitGame(room, game) {
    const patch = {
      gameState: game,
      ...(game.result ? { status: "FINISHED", endedAt: new Date() } : {}),
    };
    const write = async (db) => {
      const changed = await db.match.updateMany({
        where: { id: room.id, version: room.version, status: "ACTIVE" },
        data: { ...patch, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new GameError("Galds ir mainījies. Izvēlies gājienu vēlreiz.");
      if (game.result) {
        const loser = game.result.loser;
        await db.matchPlayer.updateMany({
          where: { matchId: room.id },
          data: { result: loser === null ? null : "WIN" },
        });
        if (loser !== null)
          await db.matchPlayer.updateMany({
            where: { matchId: room.id, id: BigInt(loser) },
            data: { result: "DURAK" },
          });
      }
    };
    // Normal moves need only one atomic UPDATE after the authoritative read.
    // Completion still commits the game and all participant results together.
    if (game.result) await prisma.$transaction(write, { timeout: 15000 });
    else await write(prisma);
    const updated = {
      ...room,
      ...patch,
      version: room.version + 1,
      players: game.result
        ? room.players.map((p) => ({
            ...p,
            result:
              game.result.loser === null
                ? null
                : String(p.id) === game.result.loser
                  ? "DURAK"
                  : "WIN",
          }))
        : room.players,
    };
    events.emit("changed", room.roomCode, updated);
    return updated;
  }
  async function action(code, who, move, version, knownRoom = null) {
    // Only the socket server supplies this snapshot, never a browser payload.
    // The conditional DB write still rejects any intervening change, so using
    // an already committed snapshot saves a WAN read without losing durability.
    const room =
      knownRoom?.roomCode === code && knownRoom.version === version
        ? knownRoom
        : await load(code);
    const p = requireMember(room, who);
    if (!room.gameState || room.status !== "ACTIVE")
      throw new GameError("Spēle nav aktīva.");
    if (version !== room.version)
      throw new GameError("Galds ir mainījies. Izvēlies gājienu vēlreiz.");
    return commitGame(room, applyMove(room.gameState, String(p.id), move));
  }
  function view(room, who) {
    const p = requireMember(room, who);
    if (!room.gameState) throw new GameError("Šī nav multiplayer spēle.");
    return privateView(room.gameState, String(p.id), room.version);
  }
  async function activeClocks() {
    return prisma.match.findMany({
      where: { status: "ACTIVE" },
      select: { roomCode: true, gameState: true, version: true },
    });
  }
  async function expireRoom(code) {
    const room = await load(code);
    if (!room.gameState || room.status !== "ACTIVE") return room;
    const game = structuredClone(room.gameState);
    return advanceClock(game) ? commitGame(room, game) : room;
  }
  async function expire() {
    for (const room of await activeClocks()) {
      if (!room.gameState || !advanceClock(structuredClone(room.gameState)))
        continue;
      await expireRoom(room.roomCode);
    }
  }
  return {
    prisma,
    events,
    identity,
    load,
    edit,
    action,
    view,
    expire,
    activeClocks,
    expireRoom,
    requireMember,
    include,
  };
}
