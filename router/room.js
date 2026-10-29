import { Router } from "express";
import { createInvites } from "../lib/invites.js";
import { createMultiplayer, GameError } from "../lib/multiplayer.js";
import {
  createMatchService,
  member,
  nameOf,
  publicRoom,
} from "../lib/matches.js";

const modes = ["classic", "passing", "japan"];
const fail = (message, status = 409) => {
  throw new GameError(message, status);
};
const waiting = (room) => {
  if (room.status !== "WAITING") fail("Spēle jau ir sākusies vai beigusies.");
};
const host = (room, identity) => {
  if (
    member(room, identity)?.id !== room.players[0]?.id ||
    !room.players.length
  )
    fail("Darbība atļauta tikai istabas izveidotājam.", 403);
};
const playerData = (identity, name) => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 50)
    fail("Norādi vārdu līdz 50 rakstzīmēm.", 400);
  if (!identity.key) fail("Nepieciešama viesu sīkdatne.", 401);
  return {
    playerKey: identity.key,
    ...(identity.user
      ? { userId: identity.user.id }
      : { guestName: name.trim() }),
  };
};

const signedIn = (req) =>
  req.identity.user ?? fail("Ielūgumi pieejami tikai pieslēgušies lietotājiem.", 401);

export function createRoomsRouter(
  prisma,
  { service = createMatchService(prisma), invites = createInvites() } = {},
) {
  const router = Router();
  router.use(async (req, res, next) => {
    try {
      if (
        ["POST", "PATCH", "DELETE"].includes(req.method) &&
        (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      ) {
        throw new GameError("Nederīgs pieprasījums.", 400);
      }
      req.identity = await service.identity(req, res);
      res.set("Cache-Control", "no-store");
      next();
    } catch (e) {
      next(e);
    }
  });
  const send = (res, room, req, status = 200) =>
    res.status(status).json({ room: publicRoom(room, req.identity) });
  const route = (method, path, fn) =>
    router[method](path, async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
        if (["P2002", "P2034"].includes(e.code))
          return res
            .status(409)
            .json({ error: "Istaba mainījās. Mēģini vēlreiz." });
        next(e);
      }
    });
  route("post", "/", async (req, res) => {
    const { code, mode, name, allowGuests = false } = req.body;
    if (
      !/^[A-Z0-9]{8}$/.test(code ?? "") ||
      !modes.includes(mode) ||
      typeof allowGuests !== "boolean"
    )
      fail("Nederīgs kods vai režīms.", 400);
    const data = playerData(req.identity, name);
    try {
      // The unique roomCode constraint handles collisions atomically. Avoid a
      // WAN round trip checking a randomly generated code before every insert.
      const room = await prisma.match.create({
        data: { roomCode: code, mode, allowGuests, players: { create: data } },
        include: service.include,
      });
      send(res, room, req, 201);
    } catch (error) {
      if (error.code !== "P2002") throw error;
      // A reload/retry by the same host returns the existing room, without
      // replacing settings or granting ownership to someone with its code.
      const existing = await prisma.match.findUnique({
        where: { roomCode: code },
        include: service.include,
      });
      if (!existing) throw error;
      host(existing, req.identity);
      send(res, existing, req);
    }
  });
  async function join(code, req) {
    const data = playerData(req.identity, req.body.name);
    return service.edit(code, async (room, db) => {
      if (member(room, req.identity)) return null;
      waiting(room);
      if (!req.identity.user && !room.allowGuests)
        fail("Šajā istabā viesi bez konta nav atļauti.", 403);
      if (room.players.length >= 6) fail("Istaba ir pilna.");
      await db.matchPlayer.create({ data: { matchId: room.id, ...data } });
    });
  }
  route("post", "/quickplay", async (req, res) => {
    if (!modes.includes(req.body.mode)) fail("Nederīgs režīms.", 400);
    const candidates = await prisma.match.findMany({
      where: {
        mode: req.body.mode,
        status: "WAITING",
        allowGuests: true,
        createdAt: {
          gte: new Date(Date.now() - 30 * 60 * 1000),
        },
      },
      include: service.include,
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    
    const room = candidates.find(
      (r) =>
        r.players.length > 0 &&
        r.players.length < 6 &&
        !member(r, req.identity),
    );
    if (!room) fail("Nav atrasta brīva istaba. Izveido jaunu istabu!", 404);
    send(res, await join(room.roomCode, req), req);
  });
  route("post", "/invites/:id/accept", async (req, res) => {
    const user = signedIn(req);
    const invite = invites.take(req.params.id, user.id);
    const memberships = await prisma.matchPlayer.findMany({
      where: { userId: user.id, match: { is: { status: { in: ["WAITING", "ACTIVE"] } } } },
      select: { match: { select: { roomCode: true, status: true } } },
    });
    if (memberships.some(({ match }) => match.status === "ACTIVE"))
      fail("Vispirms pabeidz pašreizējo spēli.");
    // Accepting moves the player, just like leaving their current lobby first.
    for (const { match } of memberships) {
      if (match.roomCode !== invite.roomCode) await service.leave(match.roomCode, req.identity);
    }
    const room = await join(invite.roomCode, { identity: req.identity, body: { name: user.username } })
      .catch((error) => {
        if (error.status === 404) fail("Istaba vairs nav pieejama.");
        throw error;
      });
    send(res, room, req);
  });
  route("post", "/invites/:id/reject", async (req, res) => {
    invites.reject(req.params.id, signedIn(req).id);
    res.json({ message: "Ielūgums noraidīts." });
  });
  route("get", "/:code", async (req, res) => {
    const room = await service.load(req.params.code.toUpperCase());
    // The lobby polls this and bot games send a heartbeat; see sweepAbandoned.
    if (member(room, req.identity)) service.markViewed(room.roomCode);
    send(res, room, req);
  });
  route("get", "/:code/access", async (req, res) => {
    const room = await service.load(req.params.code.toUpperCase());
    if (!member(room, req.identity)) {
      waiting(room);
      if (!req.identity.user && !room.allowGuests)
        fail("Šajā istabā viesi bez konta nav atļauti.", 403);
      if (room.players.length >= 6) fail("Istaba ir pilna.");
    }
    res.json({ allowed: true });
  });
  route("post", "/:code/join", async (req, res) =>
    send(res, await join(req.params.code.toUpperCase(), req), req),
  );
  route("post", "/:code/invites", async (req, res) => {
    const user = signedIn(req);
    const friendId = /^[1-9]\d{0,18}$/.test(req.body.friendId ?? "")
      ? BigInt(req.body.friendId)
      : fail("Nederīgs drauga ID.", 400);
    const room = await service.load(req.params.code.toUpperCase());
    service.requireMember(room, req.identity);
    waiting(room);
    if (room.players.length >= 6) fail("Istaba ir pilna.");
    if (room.players.some((p) => p.userId === friendId)) fail("Draugs jau ir šajā istabā.");
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: user.id, recipientId: friendId },
          { senderId: friendId, recipientId: user.id },
        ],
      },
      include: {
        sender: { select: { username: true, status: true } },
        recipient: { select: { username: true, status: true } },
      },
    });
    if (!friendship) fail("Šis spēlētājs nav tavs draugs.", 404);
    const friend = friendship.senderId === friendId ? friendship.sender : friendship.recipient;
    if (friend.status !== "ACTIVE" || !invites.isConnected(friendId))
      fail(`${friend.username} pašlaik nav tiešsaistē.`);
    const playing = await prisma.matchPlayer.findFirst({
      where: { userId: friendId, match: { is: { status: "ACTIVE" } } },
      select: { id: true },
    });
    if (playing) fail(`${friend.username} pašlaik spēlē.`);
    invites.create({
      roomCode: room.roomCode, mode: room.mode,
      fromUserId: user.id, fromName: user.username,
      toUserId: friendId, toName: friend.username,
    });
    res.status(201).json({ message: `Ielūgums nosūtīts: ${friend.username}.` });
  });
  route("patch", "/:code/settings", async (req, res) => {
    const room = await service.edit(req.params.code.toUpperCase(), (r) => {
      host(r, req.identity);
      waiting(r);
      const { timeLimitSeconds, allowGuests } = req.body;
      if (
        timeLimitSeconds !== undefined &&
        ![0, 60, 180, 300, 600].includes(timeLimitSeconds)
      )
        fail("Nederīgs laika limits.", 400);
      if (allowGuests !== undefined && typeof allowGuests !== "boolean")
        fail("Nederīga viesu atļauja.", 400);
      return {
        ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
        ...(allowGuests !== undefined ? { allowGuests } : {}),
      };
    });
    send(res, room, req);
  });
  route("delete", "/:code/players/:playerId", async (req, res) => {
    const room = await service.edit(
      req.params.code.toUpperCase(),
      async (r, db) => {
        host(r, req.identity);
        waiting(r);
        const target = r.players.find(
          (p) => String(p.id) === req.params.playerId,
        );
        if (!target || target.id === r.players[0].id)
          fail("Šo spēlētāju nevar izņemt.", 400);
        await db.matchPlayer.delete({ where: { id: target.id } });
      },
    );
    send(res, room, req);
  });
  route("post", "/:code/start", async (req, res) => {
    const room = await service.edit(req.params.code.toUpperCase(), (r) => {
      host(r, req.identity);
      waiting(r);
      if (r.players.length < 1 || r.players.length > 6)
        fail("Istabā jābūt 1–6 spēlētājiem.");
      return {
        status: "ACTIVE",
        startedAt: new Date(),
        ...(r.players.length >= 2
          ? {
              gameState: createMultiplayer(
                r.players.map((p) => ({ id: String(p.id), name: nameOf(p) })),
                r.mode,
                r.timeLimitSeconds,
              ),
            }
          : {}),
      };
    });
    send(res, room, req);
  });
  route("get", "/:code/game", async (req, res) =>
    res.json({
      game: service.view(
        await service.load(req.params.code.toUpperCase()),
        req.identity,
      ),
    }),
  );
  // Only legacy solo games accept client completion. Multiplayer results are server-owned.
  route("post", "/:code/finish", async (req, res) => {
    const room = await service.edit(req.params.code.toUpperCase(), (r) => {
      service.requireMember(r, req.identity);
      if (r.gameState) fail("Multiplayer rezultātu nosaka serveris.", 403);
      if (r.status === "FINISHED") return null;
      if (r.status !== "ACTIVE" || r.players.length !== 1)
        fail("Spēle nav aktīva.");
      return { status: "FINISHED", endedAt: new Date() };
    });
    send(res, room, req);
  });
  route("post", "/:code/leave", async (req, res) => {
    send(res, await service.leave(req.params.code.toUpperCase(), req.identity, req.body.membershipId ?? null), req);
  });
  return router;
}
