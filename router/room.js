
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


  async function cleanupAbandonedRooms() {
    const now = Date.now();

    const waitingCutoff = new Date(
      now - 30 * 60 * 1000
    );

    const activeCutoff = new Date(
      now - 6 * 60 * 60 * 1000
    );

    const staleRooms = await prisma.match.findMany({
      where: {
        status: {
          in: ["WAITING", "ACTIVE"],
        },
        OR: [
          // Empty waiting rooms.
          {
            status: "WAITING",
            players: {
              none: {},
            },
          },

          // Waiting rooms older than 30 minutes.
          {
            status: "WAITING",
            createdAt: {
              lt: waitingCutoff,
            },
          },

          // Active games older than 6 hours.
          {
            status: "ACTIVE",
            startedAt: {
              lt: activeCutoff,
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (staleRooms.length === 0) return;

    const result = await prisma.match.updateMany({
      where: {
        id: {
          in: staleRooms.map((room) => room.id),
        },
        status: {
          in: ["WAITING", "ACTIVE"],
        },
      },
      data: {
        status: "FINISHED",
        endedAt: new Date(),
      },
    });

    console.log(
      `[Room cleanup] Finished ${result.count} stale rooms.`
    );
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

  // Finish a room after the game ends.
router.post("/:code/finish", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    const { playerId } = req.body;
    const user = await getCurrentUser(req);

    if (typeof playerId !== "string" || !playerId.trim()) {
      return res.status(400).json({
        error: "Trūkst spēlētāja datu.",
      });
    }

    const room = await prisma.match.findUnique({
      where: { roomCode: code },
      include: {
        players: {
          orderBy: { id: "asc" },
          include: { user: true },
        },
      },
    });

    if (!room) {
      return res.status(404).json({
        error: "Istaba nav atrasta.",
      });
    }

    // Only a player who belongs to this room can finish it.
    const player = findRoomPlayer(room, playerId.trim(), user);

    if (!player) {
      return res.status(403).json({
        error: "Tev nav atļauts pabeigt šo spēli.",
      });
    }

    // Make repeated finish requests safe.
    if (room.status === "FINISHED") {
      return res.status(200).json({
        room: publicRoom(room),
      });
    }

    if (room.status !== "ACTIVE") {
      return res.status(409).json({
        error: "Spēle nav aktīva.",
      });
    }

    const updated = await prisma.match.updateMany({
      where: {
        id: room.id,
        status: "ACTIVE",
      },
      data: {
        status: "FINISHED",
        endedAt: new Date(),
      },
    });

    const finishedRoom = await prisma.match.findUnique({
      where: { id: room.id },
      include: {
        players: {
          orderBy: { id: "asc" },
          include: { user: true },
        },
      },
    });

    return res.status(200).json({
      room: publicRoom(finishedRoom),
      alreadyFinished: updated.count === 0,
    });
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

  // Quickplay: find and join an eligible waiting room.
  router.post("/quickplay", async (req, res, next) => {
    try {
      const { mode, playerId, name } = req.body;
      const user = await getCurrentUser(req);

      const validModes = ["classic", "passing", "japan", "duraklash"];

      if (!validModes.includes(mode)) {
        return res.status(400).json({
          error: "Nederīgs spēles režīms.",
        });
      }

      if (
        typeof playerId !== "string" ||
        !playerId.trim() ||
        typeof name !== "string" ||
        !name.trim()
      ) {
        return res.status(400).json({
          error: "Trūkst spēlētāja datu.",
        });
      }

      const result = await prisma.$transaction(
        async (tx) => {
          const waitingCutoff = new Date(Date.now() - 10 * 60 * 1000);

          const candidates = await tx.match.findMany({
            where: {
              mode,
              status: "WAITING",
              createdAt: { gte: waitingCutoff },
              ...(user ? {} : { allowGuests: true }),
            },
            include: {
              players: {
                orderBy: { id: "asc" },
                include: { user: true },
              },
            },
            orderBy: { createdAt: "asc" },
          });

          // Skip full rooms and rooms where this identity is already present.
          // Check playerKey as well as userId because playerKey is unique
          // within a room, including for logged-in users.
          const candidate = candidates.find((room) => {
            if (room.players.length >= 6) return false;

            const alreadyPresent = room.players.some((p) =>
              p.playerKey === playerId.trim() ||
              (user && p.userId === user.id)
            );

            return !alreadyPresent;
          });

          if (!candidate) return null;

          // Reload the room inside the transaction before joining.
          const currentRoom = await tx.match.findUnique({
            where: { id: candidate.id },
            include: {
              players: {
                orderBy: { id: "asc" },
                include: { user: true },
              },
            },
          });

          if (
            !currentRoom ||
            currentRoom.status !== "WAITING" ||
            currentRoom.mode !== mode ||
            currentRoom.players.length >= 6 ||
            (!user && !currentRoom.allowGuests)
          ) {
            return null;
          }

          // Critical second check: membership may have changed since
          // the candidate list was loaded.
          const alreadyPresent = currentRoom.players.some((p) =>
            p.playerKey === playerId.trim() ||
            (user && p.userId === user.id)
          );

          if (alreadyPresent) return null;

          await tx.matchPlayer.create({
            data: {
              matchId: currentRoom.id,
              playerKey: playerId.trim(),
              guestName: user ? null : name.trim().slice(0, 50),
              ...(user ? { userId: user.id } : {}),
            },
          });

          return tx.match.findUnique({
            where: { id: currentRoom.id },
            include: {
              players: {
                orderBy: { id: "asc" },
                include: { user: true },
              },
            },
          });
        },
        { isolationLevel: "Serializable" }
      );

      if (!result) {
        return res.status(404).json({
          error: "Nav atrasta brīva istaba. Mēģini vēlreiz!",
          code: "NO_QUICKPLAY_ROOM",
        });
      }

      return res.status(200).json({
        room: publicRoom(result),
      });
    } catch (error) {
      if (error.code === "P2034") {
        return res.status(409).json({
          error: "Istaba tikko aizpildījās. Mēģini vēlreiz!",
          code: "QUICKPLAY_RETRY",
        });
      }

      // Handle a unique-key conflict without exposing a server error.
      if (error.code === "P2002") {
        return res.status(409).json({
          error: "Neizdevās pievienoties istabai. Mēģini Quickplay vēlreiz!",
          code: "QUICKPLAY_DUPLICATE_PLAYER",
        });
      }

      next(error);
    }
  });


  router.get("/:code/access", async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      const room = await loadRoom(code);

      if (!room) {
        return res.status(404).json({
          error: "Istaba nav atrasta.",
        });
      }

      const user = await getCurrentUser(req);

      if (!user && !room.allowGuests) {
        return res.status(403).json({
          error: "Šajā istabā viesi bez konta nav atļauti.",
          code: "GUESTS_NOT_ALLOWED",
        });
      }

      return res.json({ allowed: true });
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

      // Check that the room exists before accessing its properties.
      if (!room) {
        return res.status(404).json({
          error: "Istaba nav atrasta.",
        });
      }

      // Reject guests if the host has disabled guest access.
      if (!user && !room.allowGuests) {
        return res.status(403).json({
          error: "Šajā istabā viesi bez konta nav atļauti.",
          code: "GUESTS_NOT_ALLOWED",
        });
      }

      if (!playerId || !name) {
        return res.status(400).json({ error: "Trūkst spēlētāja datu." });
      }

      // Allow existing members to return to an active room.
      const existing = await findRoomPlayer(room, playerId, user);

      if (existing) {
        return res.json({ room: publicRoom(room) });
      }

      // New players cannot join after the game starts.
      if (room.status !== "WAITING") {
        return res.status(409).json({
          error: "Spēle jau ir sākusies.",
        });
      }

      if (room.players.length >= 6) {
        return res.status(409).json({
          error: "Istaba ir pilna.",
        });
      }

      await prisma.matchPlayer.create({
        data: {
          matchId: room.id,
          playerKey: playerId,
          guestName: user ? null : (name.trim() || "Viesis"),
          ...(user ? { userId: user.id } : {}),
        },
      });

      const updated = await loadRoom(code);
      return res.status(201).json({
        room: publicRoom(updated),
      });
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

      if (room.players.length < 1) {
        return res.status(400).json({ error: "Istabā jābūt vismaz vienam spēlētājam." });
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
 
  // Leave a room.
  router.post("/:code/leave", async (req, res, next) => {
    try {
      const code = req.params.code.toUpperCase();
      const { playerId } = req.body;

      if (typeof playerId !== "string" || !playerId.trim()) {
        return res.status(400).json({
          error: "Trūkst spēlētāja ID.",
        });
      }

      const room = await loadRoom(code);

      if (!room) {
        return res.status(404).json({
          error: "Istaba nepastāv.",
        });
      }

      const user = await getCurrentUser(req);
      const player = await findRoomPlayer(room, playerId.trim(), user);

      if (!player) {
        return res.status(404).json({
          error: "Spēlētājs nav atrasts šajā istabā.",
        });
      }

      const isHost = room.players[0]?.id === player.id;

      // If the host leaves before starting, close the waiting room.
      if (room.status === "WAITING" && isHost) {
        await prisma.match.updateMany({
          where: {
            id: room.id,
            status: "WAITING",
          },
          data: {
            status: "FINISHED",
            endedAt: new Date(),
          },
        });

        return res.json({
          success: true,
          roomDestroyed: false,
          status: "finished",
        });
      }

      // In a local bot game, the human is the only registered player.
      // If that player leaves, finish the match but keep its history.
      if (room.status === "ACTIVE" && room.players.length === 1) {
        await prisma.match.updateMany({
          where: {
            id: room.id,
            status: "ACTIVE",
          },
          data: {
            status: "FINISHED",
            endedAt: new Date(),
          },
        });

        return res.json({
          success: true,
          roomDestroyed: false,
          status: "finished",
        });
      }

      // In a multiplayer game, one player leaving does not finish
      // the entire active match.
      await prisma.matchPlayer.delete({
        where: { id: player.id },
      });

      // If a waiting room has become empty, mark it finished.
      if (room.status === "WAITING" && room.players.length === 1) {
        await prisma.match.updateMany({
          where: {
            id: room.id,
            status: "WAITING",
          },
          data: {
            status: "FINISHED",
            endedAt: new Date(),
          },
        });
      }

      return res.json({
        success: true,
        roomDestroyed: false,
        status: room.status.toLowerCase(),
      });
    } catch (error) {
      next(error);
    }
  });

  // Run cleanup once on startup and every 15 minutes.
  cleanupAbandonedRooms().catch((error) => {
    console.error("[Room cleanup] Failed:", error);
  });

  const cleanupInterval = setInterval(() => {
    cleanupAbandonedRooms().catch((error) => {
      console.error("[Room cleanup] Failed:", error);
    });
  }, 15 * 60 * 1000);

  cleanupInterval.unref();

  return router;
}
