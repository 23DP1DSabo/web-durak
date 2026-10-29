import { archiveRound } from "./history.js";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  GameError,
  applyMove,
  advanceClock,
  privateView,
  createMultiplayer,
  nextRoundPlayers,
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
      avatar: p.user?.avatar ?? null,
      role: i === 0 ? "host" : "player",
      isGuest: p.userId === null,
    })),
  };
}
export function createMatchService(prisma, { presence = null } = {}) {
  const events = new EventEmitter();
  // Lobbies and bot games have no server clock, so members' page views are
  // the only sign of life. Kept in memory: after a restart, every room gets a
  // fresh grace period instead of being closed immediately.
  const serviceStartedAt = Date.now();
  const lastViewed = new Map();
  async function identity(req, res) {
    const token = cookie(req, "durak_session");
    let user = null,
      sessionExpiresAt = null;
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
      sessionExpiresAt = session.expiresAt;
      presence?.touch(session.tokenHash);
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
    return {
      user,
      key: guest ? hash(guest) : null,
      sessionHash: user ? hash(token) : null,
      sessionExpiresAt,
    };
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
  async function leave(code, who, membershipId = null) {
    const room = await load(code);
    const p = member(room, who);
    // A delayed retry must never remove a new membership after rejoining.
    if (!p || (membershipId !== null && String(p.id) !== membershipId)) {
      throw Object.assign(new GameError("Tu neesi šīs istabas dalībnieks.", 403), { code: "NOT_ROOM_MEMBER" });
    }
    const gamePlayer = room.gameState?.players.find((player) => player.id === String(p.id));
    const nextLobby = room.gameState?.nextRoundLobby;
    if (nextLobby?.members?.[String(p.id)] && !gamePlayer?.excludedFromRound) {
      // A second player may leave from the old result screen before receiving
      // the lobby redirect. Apply that intent to their new membership as well.
      try {
        await leave(nextLobby.code, who, nextLobby.members[String(p.id)]);
      } catch (error) {
        if (error.status !== 404 && error.code !== "NOT_ROOM_MEMBER") throw error;
      }
    }

    if (room.gameState && (room.status === "FINISHED" || gamePlayer?.out)) {
      if (!gamePlayer || gamePlayer.excludedFromRound || ["resign", "inactive"].includes(gamePlayer.exitReason)) return room;
      return edit(code, async (current, db) => {
        const participant = requireMember(current, who);
        const game = structuredClone(current.gameState);
        const leavingPlayer = game?.players.find((player) => player.id === String(participant.id));
        if (!leavingPlayer || leavingPlayer.excludedFromRound) return {};
        if (current.status !== "FINISHED" && !leavingPlayer.out) {
          throw new GameError("Istaba mainījās. Mēģini vēlreiz.");
        }
        // Keep the completed round's result and participant history intact.
        leavingPlayer.excludedFromRound = true;
        game.nextRoundReady = (game.nextRoundReady || []).filter((id) => id !== leavingPlayer.id);
        return current.status === "FINISHED"
          ? nextRoundPatch(current, game, db)
          : { gameState: game };
      });
    }
    if (room.status === "FINISHED") return room;
    if (room.status === "ACTIVE" && room.gameState) {
      // A retried leave after the next round started must not resign a player
      // who was already excluded from that round.
      if (!gamePlayer) return room;
      return action(code, who, { type: "resign" }, room.version, room);
    }
    const closesRoom = room.status === "ACTIVE" || room.players[0].id === p.id;
    const patch = closesRoom ? { status: "FINISHED", endedAt: new Date() } : {};
    const write = async (db) => {
      // The version guards the snapshot's status, host and membership. If a
      // concurrent join/start/settings write won, do not act on stale data.
      const changed = await db.match.updateMany({
        where: { id: room.id, version: room.version, status: room.status },
        data: { ...patch, version: { increment: 1 } },
      });
      if (!changed.count) throw new GameError("Istaba mainījās. Mēģini vēlreiz.");
      if (!closesRoom) await db.matchPlayer.delete({ where: { id: p.id } });
    };
    // Host closure is one atomic update. Guest removal needs a transaction
    // so deletion and the version change either both commit or both roll back.
    if (closesRoom) await write(prisma);
    else await prisma.$transaction(write, { timeout: 15000 });
    const updated = { ...room, ...patch, version: room.version + 1,
      players: closesRoom ? room.players : room.players.filter((other) => other.id !== p.id) };
    events.emit("changed", code, updated);
    return updated;
  }
  async function commitGame(room, game, who = null, prepareBroadcast = null) {
    // An authenticated socket is bound at join. Verify its session again inside
    // the same atomic SQL write, avoiding a separate WAN round trip per move.
    if (who?.user && !/^[a-f0-9]{64}$/.test(who.sessionHash || ""))
      throw new GameError("Sesija ir beigusies. Pieslēdzies vēlreiz.", 401);
    const audience = prepareBroadcast?.();
    const eliminated = game.players.filter((p) => ["resign", "timeout", "inactive"].includes(p.exitReason) &&
      room.gameState.players.find((old) => old.id === p.id)?.exitReason !== p.exitReason)
      .map((p) => p.id);
    const losers = game.result
      ? (game.result.losers ?? [game.result.loser].filter((id) => id !== null))
      : eliminated;
    const savesResults = Boolean(game.result) || eliminated.length > 0;
    const patch = {
      gameState: game,
      ...(game.result ? { status: "FINISHED", endedAt: new Date() } : {}),
    };
    const write = async (db) => {
      const changed = await db.match.updateMany({
        where: {
          id: room.id,
          version: room.version,
          status: "ACTIVE",
          ...(who?.user
            ? {
                players: {
                  some: {
                    userId: who.user.id,
                    user: {
                      is: {
                        status: "ACTIVE",
                        sessions: {
                          some: {
                            tokenHash: who.sessionHash,
                            expiresAt: { gt: new Date() },
                          },
                        },
                      },
                    },
                  },
                },
              }
            : {}),
        },
        data: { ...patch, version: { increment: 1 } },
      });
      if (!changed.count) {
        if (who?.user) {
          const session = await db.session.findUnique({
            where: { tokenHash: who.sessionHash },
            include: { user: true },
          });
          if (
            !session ||
            session.userId !== who.user.id ||
            session.expiresAt <= new Date() ||
            session.user.status !== "ACTIVE"
          )
            throw new GameError(
              "Sesija ir beigusies. Pieslēdzies vēlreiz.",
              401,
            );
        }
        throw Object.assign(
          new GameError("Galds ir mainījies. Izvēlies gājienu vēlreiz."),
          { code: "MOVE_CONFLICT" },
        );
      }
      if (game.result) {
        const participatingIds = game.players
          .filter((p) => !p.excludedFromRound)
          .map((p) => BigInt(p.id));

        if (participatingIds.length) {
          await db.matchPlayer.updateMany({
            where: {
              matchId: room.id,
              id: { in: participatingIds },
            },
            data: { result: losers.length ? "WIN" : null },
          });
        }
      }
      if (game.result) await archiveRound(db, room, game, patch.endedAt);
      for (const id of losers) {
        await db.matchPlayer.updateMany({
          where: { matchId: room.id, id: BigInt(id) },
          data: { result: "DURAK" },
        });
      }
    };
    // Elimination and completion commit participant results with the game.
    // Ordinary moves retain the single atomic UPDATE fast path.
    if (savesResults) await prisma.$transaction(write, { timeout: 15000 });
    else await write(prisma);
    const updated = {
      ...room,
      ...patch,
      version: room.version + 1,
      players: savesResults
        ? room.players.map((p) => {
            const participates = game.players.some(
              (gp) => gp.id === String(p.id) && !gp.excludedFromRound,
            );

            if (!participates) return p;

            return {
              ...p,
              result: losers.includes(String(p.id))
                ? "DURAK"
                : game.result
                  ? losers.length
                    ? "WIN"
                    : null
                  : p.result,
            };
          })
        : room.players,
    };
    events.emit("changed", room.roomCode, updated, audience);
    return updated;
  }
  async function action(
    code,
    who,
    move,
    version,
    knownRoom = null,
    prepareBroadcast = null,
  ) {
    let room =
      knownRoom?.roomCode === code && knownRoom.version === version
        ? knownRoom
        : await load(code);
    // Rebase only explicit card actions inside the same bout, then validate
    // ownership, target, role and capacity again. Never replay an ambiguous save.
    const canRebase =
      Number.isInteger(move?.bout) &&
      (move.type === "attack" ||
        (move.type === "defend" && typeof move.targetId === "string"));
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = requireMember(room, who);
      if (!room.gameState || room.status !== "ACTIVE")
        throw new GameError("Spēle nav aktīva.");
      if (
        version !== room.version &&
        !(
          canRebase &&
          Number.isInteger(version) &&
          version < room.version &&
          move.bout === (room.gameState.bout ?? 0)
        )
      )
        throw new GameError("Galds ir mainījies. Izvēlies gājienu vēlreiz.");
      try {
        return await commitGame(
          room,
          applyMove(room.gameState, String(p.id), move),
          who,
          prepareBroadcast,
        );
      } catch (error) {
        if (error.code !== "MOVE_CONFLICT" || !canRebase || attempt === 2)
          throw error;
        room = await load(code);
      }
    }
  }

  async function nextRoundPatch(room, game, db) {
    const eligible = nextRoundPlayers(game);
    const eligibleIds = new Set(eligible.map((p) => p.id));
    const ready = new Set((game.nextRoundReady || []).filter((id) => eligibleIds.has(id)));
    game.nextRoundReady = [...ready];
    if (game.nextRoundLobby) return { gameState: game };
    // An incomplete rematch goes back to a lobby instead of dealing cards to
    // a smaller group. A separate match preserves the finished game's results.
    if (eligible.length > 0 && eligible.length < game.players.length) {
      const participants = room.players.filter((p) => eligibleIds.has(String(p.id)));
      const lobby = await db.match.create({
        data: {
          roomCode: randomBytes(4).toString("hex").toUpperCase(),
          mode: room.mode, timeLimitSeconds: room.timeLimitSeconds, allowGuests: room.allowGuests,
          players: { create: participants.map((p) => ({
            playerKey: p.playerKey, userId: p.userId, guestName: p.guestName,
          })) },
        },
        include,
      });
      game.nextRoundLobby = {
        code: lobby.roomCode,
        members: Object.fromEntries(participants.map((p) => [String(p.id),
          String(lobby.players.find((next) => p.userId !== null
            ? next.userId === p.userId : next.playerKey === p.playerKey).id)])),
      };
      return { gameState: game };
    }
    if (eligible.length < 2 || !eligible.every((p) => ready.has(p.id))) {
      return { gameState: game };
    }
    const nextGame = createMultiplayer(
      eligible.map((p) => ({ id: p.id, name: p.name })),
      room.mode,
      room.timeLimitSeconds,
    );
    nextGame.nextRoundReady = [];
    await db.matchPlayer.updateMany({
      where: { matchId: room.id, id: { in: eligible.map((p) => BigInt(p.id)) } },
      data: { result: null },
    });
    return { gameState: nextGame, status: "ACTIVE", startedAt: new Date(), endedAt: null };
  }

  async function readyNextRound(code, who, version) {
    return edit(code, async (room, db) => {
      if (room.version !== version) {
        throw new GameError("Istaba mainījās. Atjauno spēles stāvokli un mēģini vēlreiz.");
      }
      const participant = requireMember(room, who);
      if (room.status !== "FINISHED" || !room.gameState?.result) {
        throw new GameError("Nākamo kārtu pašlaik nevar sākt.");
      }
      if (who?.user) {
        const session = await db.session.findUnique({
          where: { tokenHash: who.sessionHash }, include: { user: true },
        });
        if (!session || session.userId !== who.user.id || session.expiresAt <= new Date() ||
            session.user.status !== "ACTIVE") {
          throw new GameError("Sesija ir beigusies. Pieslēdzies vēlreiz.", 401);
        }
      }
      const game = structuredClone(room.gameState);
      const playerId = String(participant.id);
      if (!nextRoundPlayers(game).some((p) => p.id === playerId)) {
        throw new GameError("Tu nevari balsot par nākamo kārtu šajā spēlē.", 403);
      }
      const ready = new Set(game.nextRoundReady || []);
      if (ready.has(playerId)) ready.delete(playerId);
      else ready.add(playerId);
      game.nextRoundReady = [...ready];
      return nextRoundPatch(room, game, db);
    });
  }

  function view(room, who) {
    const p = requireMember(room, who);
    if (!room.gameState) throw new GameError("Šī nav multiplayer spēle.");
    const result = privateView(room.gameState, String(p.id), room.version);
    const avatars = new Map(room.players.map((member) => [String(member.id), member.user?.avatar ?? null]));
    result.players = result.players.map((player) => ({ ...player, avatar: avatars.get(player.id) ?? null }));
    return result;
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
  function markViewed(code, now = Date.now()) {
    lastViewed.set(code, now);
  }
  // Closes lobbies and bot games that no member has viewed for idleMs, e.g.
  // a closed tab. Otherwise they stay open forever and block account deletion.
  async function sweepAbandoned({ now = Date.now(), idleMs = 10 * 60 * 1000 } = {}) {
    const cutoff = now - idleMs;
    for (const [code, viewedAt] of lastViewed) if (viewedAt <= cutoff) lastViewed.delete(code);
    if (serviceStartedAt > cutoff) return [];
    const rooms = await prisma.match.findMany({
      where: { status: { in: ["WAITING", "ACTIVE"] }, createdAt: { lt: new Date(cutoff) } },
      select: { id: true, roomCode: true, status: true, version: true, gameState: true },
    });
    const closed = [];
    for (const room of rooms) {
      // Multiplayer games end through their own clocks and resignations.
      if (room.gameState || lastViewed.has(room.roomCode)) continue;
      const changed = await prisma.match.updateMany({
        where: { id: room.id, version: room.version, status: room.status },
        data: { status: "FINISHED", endedAt: new Date(now), version: { increment: 1 } },
      });
      if (changed.count) closed.push(room.roomCode);
    }
    return closed;
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
    leave,
    action,
    readyNextRound,
    view,
    expire,
    activeClocks,
    expireRoom,
    markViewed,
    sweepAbandoned,
    requireMember,
    include,
  };
}
