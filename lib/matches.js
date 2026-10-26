import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  GameError,
  applyMove,
  advanceClock,
  privateView,
  createMultiplayer,
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

    async function readyNextRound(code, who, version) {
      const updated = await edit(code, async (room, db) => {
        if (room.version !== version) {
          throw new GameError(
            "Istaba mainījās. Atjauno spēles stāvokli un mēģini vēlreiz.",
          );
        }

        const participant = requireMember(room, who);
        const currentGame = room.gameState;

        if (room.status !== "FINISHED" || !currentGame?.result) {
          throw new GameError("Nākamo kārtu pašlaik nevar sākt.");
        }

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
          ) {
            throw new GameError(
              "Sesija ir beigusies. Pieslēdzies vēlreiz.",
              401,
            );
          }
        }

        const game = structuredClone(currentGame);

        const eligibleIds = game.players
          .filter(
            (p) =>
              !p.excludedFromRound &&
              !["resign", "inactive"].includes(p.exitReason),
          )
          .map((p) => p.id);

        const playerId = String(participant.id);

        if (!eligibleIds.includes(playerId)) {
          throw new GameError(
            "Tu nevari balsot par nākamo kārtu šajā spēlē.",
            403,
          );
        }

        const ready = new Set(
          (game.nextRoundReady || []).filter((id) => eligibleIds.includes(id)),
        );

        // clicking the ready button again removes the players vote to continue
        // until all players agree
        if (ready.has(playerId)) {
          ready.delete(playerId);
        } else {
          ready.add(playerId);
        }

        game.nextRoundReady = [...ready];

        const allReady =
          eligibleIds.length >= 2 &&
          eligibleIds.every((id) => ready.has(id));

        if (!allReady) {
          return { gameState: game };
        }

        const eligibleSet = new Set(eligibleIds);
        const continuingPlayers = game.players
          .filter((p) => eligibleSet.has(p.id))
          .map((p) => ({ id: p.id, name: p.name }));

        const nextGame = createMultiplayer(
          continuingPlayers,
          room.mode,
          room.timeLimitSeconds,
        );

        // keep the players that left in the room view,
        // but doesnt let them play or vote for later rounds
        for (const oldPlayer of game.players) {
          if (eligibleSet.has(oldPlayer.id)) continue;

          nextGame.players.push({
            ...oldPlayer,
            hand: [],
            out: true,
            remainingMs: 0,
            exitReason: oldPlayer.exitReason || "eliminated",
            excludedFromRound: true,
          });
        }

        nextGame.nextRoundReady = [];

        await db.matchPlayer.updateMany({
          where: {
            matchId: room.id,
            id: { in: continuingPlayers.map((p) => BigInt(p.id)) },
          },
          data: { result: null },
        });

        return {
          gameState: nextGame,
          status: "ACTIVE",
          startedAt: new Date(),
          endedAt: null,
        };
      });

      return updated;
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
    readyNextRound,
    view,
    expire,
    activeClocks,
    expireRoom,
    requireMember,
    include,
  };
}
