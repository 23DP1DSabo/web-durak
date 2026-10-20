
import { Router } from "express";
import { randomUUID } from "node:crypto";

export function createRoomsRouter(prisma, { getSessionToken, hashToken } = {}) {
  const router = Router();

  async function getCurrentUser(req) {
    if (!getSessionToken || !hashToken) return null;

    const token = getSessionToken(req);
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date()) return null;
    if (session.user.status !== "ACTIVE") return null;

    return session.user;
  }

  async function loadRoom(code) {
    return prisma.match.findUnique({
      where: { roomCode: code },
      include: {
        players: {
          orderBy: { id: "asc" },
          include: { user: true },
        },
      },
    });
  }

  function publicRoom(room) {
    const host = room.players[0];

    return {
      code: room.roomCode,
      mode: room.mode,
      status: room.status.toLowerCase(),
      timeLimitSeconds: room.timeLimitSeconds,
      allowGuests: room.allowGuests,
      startedAt: room.startedAt,
      hostId: host?.playerKey ?? null,
      players: room.players.map((p, index) => ({
        id: p.playerKey,
        name: 
          p.user?.name || 
          p.user?.username || 
          p.guestName || 
          "Viesis",
        role: index === 0 ? "host" : "player",
        isGuest: p.userId === null,
      })),
      // include: {
      //   players: {
      //     include: {
      //       user: true,
      //     },
      //     orderBy: {
      //       id: "asc",
      //     },
      //   },
      // },
    };
  }

  async function findRoomPlayer(room, playerId, user) {
    return room.players.find((p) => {
      if (user) return p.userId === user.id;
      return p.playerKey === playerId;
    });
  }

  async function requireHost(req, room) {
    const playerId = req.body?.playerId;
    const user = await getCurrentUser(req);
    const player = await findRoomPlayer(room, playerId, user);

    return player && room.players[0]?.id === player.id;
  }

  // Create a room.
  router.post("/", async (req, res, next) => {
    try {
      const { code, mode, playerId, name, allowGuests = false } = req.body;
      const user = await getCurrentUser(req);

      if (!/^[A-Z0-9]{8}$/.test(code ?? "")) {
        return res.status(400).json({ error: "Nederīgs istabas kods." });
      }

      if (!playerId || !name || !mode) {
        return res.status(400).json({ error: "Trūkst obligāto datu." });
      }

      const existing = await loadRoom(code);
      if (existing) {
        const isOwner = await requireHost(req, existing);
        if (!isOwner) {
          return res.status(409).json({ error: "Šāds istabas kods jau eksistē." });
        }
        return res.json({ room: publicRoom(existing) });
      }

      const room = await prisma.match.create({
        data: {
          roomCode: code,
          mode,
          allowGuests: Boolean(allowGuests),
          players: {
            create: {
              playerKey: playerId,
              guestName: user ? null : name,
              ...(user ? { userId: user.id } : {}),
            },
          },
        },
        include: {
          players: { orderBy: { id: "asc" }, include: { user: true } },
        },
      });

      res.status(201).json({ room: publicRoom(room) });
    } catch (error) {
      next(error);
    }
  });

  // Get room information.
  router.get("/:code", async (req, res, next) => {
    try {
      const room = await prisma.match.findUnique({
        where: { roomCode: req.params.code.toUpperCase() },
        include: {
          players: {
            orderBy: { id: "asc" },
            include: { user: true },
          },
        },
      });

      if (!room) {
        return res.status(404).json({ error: "Istaba nav atrasta." });
      }

      res.json({ room: publicRoom(room) });
    } catch (error) {
      next(error);
    }
  });

  // Join a room.
  router.post("/:code/join", async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      const { playerId, name } = req.body;
      const user = await getCurrentUser(req);
      const room = await loadRoom(code);

      if (!room) {
        return res.status(404).json({ error: "Istaba nav atrasta." });
      }

      if (room.status !== "WAITING") {
        return res.status(409).json({ error: "Spēle jau ir sākusies." });
      }

      if (!playerId || !name) {
        return res.status(400).json({ error: "Trūkst spēlētāja datu." });
      }

      if (!user && !room.allowGuests) {
        return res.status(403).json({
          error: "Šajā istabā viesi bez konta nav atļauti.",
        });
      }

      const existing = await findRoomPlayer(room, playerId, user);
      if (existing) {
        return res.json({ room: publicRoom(room) });
      }

      if (room.players.length >= 6) {
        return res.status(409).json({ error: "Istaba ir pilna." });
      }

      await prisma.matchPlayer.create({
        data: {
          matchId: room.id,
          playerKey: playerId,
          guestName: user ? null : (name?.trim() || "Viesis"),
          ...(user ? { userId: user.id } : {}),
        },
      });

      const updated = await loadRoom(code);
      res.status(201).json({ room: publicRoom(updated) });
    } catch (error) {
      next(error);
    }
  });

  // Update room settings; only the host may do this while waiting.
  router.patch("/:code/settings", async (req, res, next) => {
    try {
      const room = await loadRoom(req.params.code.toUpperCase());

      if (!room) {
        return res.status(404).json({ error: "Istaba nav atrasta." });
      }

      if (!(await requireHost(req, room))) {
        return res.status(403).json({ error: "Tikai istabas izveidotājs var mainīt iestatījumus." });
      }

      if (room.status !== "WAITING") {
        return res.status(409).json({ error: "Spēle jau ir sākusies." });
      }

      const { timeLimitSeconds, allowGuests } = req.body;
      const allowedLimits = [60, 180, 300, 600];

      if (
        timeLimitSeconds !== undefined &&
        !allowedLimits.includes(Number(timeLimitSeconds))
      ) {
        return res.status(400).json({ error: "Nederīgs laika limits." });
      }

      const updated = await prisma.match.update({
        where: { id: room.id },
        data: {
          ...(timeLimitSeconds !== undefined
            ? { timeLimitSeconds: Number(timeLimitSeconds) }
            : {}),
          ...(allowGuests !== undefined
            ? { allowGuests: Boolean(allowGuests) }
            : {}),
        },
      });

      res.json({ room: publicRoom(await loadRoom(updated.roomCode)) });
    } catch (error) {
      next(error);
    }
  });

  // Remove a player; only the host can remove another player.
  router.delete("/:code/players/:playerId", async (req, res, next) => {
    try {
      const room = await loadRoom(req.params.code.toUpperCase());

      if (!room) {
        return res.status(404).json({ error: "Istaba nav atrasta." });
      }

      if (!(await requireHost(req, room))) {
        return res.status(403).json({ error: "Tikai istabas izveidotājs var izņemt spēlētājus." });
      }

      if (room.status !== "WAITING") {
        return res.status(409).json({ error: "Spēles laikā spēlētājus izņemt nevar." });
      }

      const target = room.players.find(
        (p) => p.playerKey === req.params.playerId
      );

      if (!target) {
        return res.status(404).json({ error: "Spēlētājs nav atrasts." });
      }

      if (target.id === room.players[0]?.id) {
        return res.status(400).json({ error: "Istabas izveidotāju izņemt nevar." });
      }

      await prisma.matchPlayer.delete({ where: { id: target.id } });

      res.json({ room: publicRoom(await loadRoom(room.roomCode)) });
    } catch (error) {
      next(error);
    }
  });

  // Start the match.
  router.post("/:code/start", async (req, res, next) => {
    try {
      const room = await loadRoom(req.params.code.toUpperCase());

      if (!room) {
        return res.status(404).json({ error: "Istaba nav atrasta." });
      }

      if (!(await requireHost(req, room))) {
        return res.status(403).json({ error: "Tikai istabas izveidotājs var sākt spēli." });
      }

      if (room.status !== "WAITING") {
        return res.status(409).json({ error: "Spēle jau ir sākusies." });
      }

      if (room.players.length < 2) {
        return res.status(400).json({ error: "Lai sāktu spēli, vajadzīgi vismaz divi spēlētāji." });
      }

      const updated = await prisma.match.update({
        where: { id: room.id },
        data: { status: "ACTIVE", startedAt: new Date() },
      });

      res.json({ room: publicRoom(await loadRoom(updated.roomCode)) });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/rooms/:code/leave
  router.post("/:code/leave", async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      const { playerId, name } = req.body;

      if (!playerId) {
        return res.status(400).json({
          error: "Trūkst spēlētāja ID.",
        });
      }

      const room = await prisma.match.findUnique({
        where: { roomCode: req.params.code.toUpperCase() },
        include: {
          players: {
            orderBy: { id: "asc" },
            include: { user: true },
          },
        },
      });

      if (!room) {
        return res.status(404).json({
          error: "Istaba nepastāv.",
        });
      }

      const user = await getCurrentUser(req);
      const player = await findRoomPlayer(room, playerId, user);

      if (!player) {
        return res.status(404).json({
          error: "Player is not in this room.",
        });
      }

      // The first player is the host in this room design.
      const host = room.players[0];
      const isLeavingHost = host?.id === player.id;

      if (isLeavingHost) {
        // The MatchPlayer records are removed through onDelete: Cascade.
        await prisma.match.delete({
          where: { id: room.id },
        });

        return res.json({
          success: true,
          roomDestroyed: true,
        });
      }

      // A regular player leaving must not destroy the room.
      await prisma.matchPlayer.delete({
        where: { id: player.id },
      });

      return res.json({
        success: true,
        roomDestroyed: false,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
