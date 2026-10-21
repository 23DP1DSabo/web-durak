import { Router } from "express";
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

export function createRoomsRouter(
  prisma,
  { service = createMatchService(prisma) } = {},
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
        if (e.status) return res.status(e.status).json({ error: e.message });
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
    const existing = await prisma.match.findUnique({
      where: { roomCode: code },
      include: service.include,
    });
    if (existing) {
      host(existing, req.identity);
      return send(res, existing, req);
    }
    const room = await prisma.match.create({
      data: { roomCode: code, mode, allowGuests, players: { create: data } },
      include: service.include,
    });
    send(res, room, req, 201);
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
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        ...(!req.identity.user ? { allowGuests: true } : {}),
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
  route("get", "/:code", async (req, res) =>
    send(res, await service.load(req.params.code.toUpperCase()), req),
  );
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
  route("patch", "/:code/settings", async (req, res) => {
    const room = await service.edit(req.params.code.toUpperCase(), (r) => {
      host(r, req.identity);
      waiting(r);
      const { timeLimitSeconds, allowGuests } = req.body;
      if (
        timeLimitSeconds !== undefined &&
        ![60, 180, 300, 600].includes(timeLimitSeconds)
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
    const code = req.params.code.toUpperCase();
    const current = await service.load(code);
    if (current.status === "ACTIVE" && current.gameState) {
      const room = await service.action(
        code,
        req.identity,
        { type: "resign" },
        current.version,
      );
      return send(res, room, req);
    }
    const room = await service.edit(code, async (r, db) => {
      const p = service.requireMember(r, req.identity);
      if (r.status === "FINISHED") return null;
      if (r.status === "ACTIVE" || r.players[0].id === p.id)
        return { status: "FINISHED", endedAt: new Date() };
      await db.matchPlayer.delete({ where: { id: p.id } });
    });
    send(res, room, req);
  });
  return router;
}
