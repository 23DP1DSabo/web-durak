
import { Router } from "express";
import { createHash } from "node:crypto";
import { allowedOrigins, isAllowedOrigin } from "../lib/origins.js";

export function createFriendsRouter(prisma, {
  getSessionToken,
  clearSessionCookie,
}) {
  const router = Router();

  function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
  }

  async function getFriendRequestUser(req, res) {
    const token = getSessionToken(req);

    if (!token) {
      res.status(401).json({ error: "Jūs neesat pieslēdzies." });
      return null;
    }

    try {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      });

      if (
        !session ||
        session.expiresAt <= new Date() ||
        session.user.status !== "ACTIVE"
      ) {
        if (session) {
          await prisma.session.deleteMany({
            where: { tokenHash: session.tokenHash },
          });
        }

        clearSessionCookie(res);
        res.status(401).json({ error: "Jūs neesat pieslēdzies." });
        return null;
      }

      return session.user;
    } catch (error) {
      console.error("Friend authentication failed:", error);
      res.status(500).json({
        error: "Neizdevās pārbaudīt pieslēgšanos.",
      });
      return null;
    }
  }

  function friendUser(user) {
    return {
      id: String(user.id),
      username: user.username,
      name: user.name,
      avatar: user.avatar,
    };
  }

  function validDatabaseId(value) {
    return typeof value === "string" && /^[1-9]\d*$/.test(value);
  }

  // Protect friend routes against cross-site requests.
  router.use("/", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");

    const origin = req.get("origin");
    const origins = allowedOrigins(
      process.env.APP_ORIGIN,
      `${req.protocol}://${req.get("host")}`,
    );

    if (
      req.get("sec-fetch-site") === "cross-site" ||
      !isAllowedOrigin(origin, origins)
    ) {
      return res.status(403).json({
        error: "Pieprasījuma izcelsme nav atļauta.",
      });
    }

    next();
  });

  // GET /api/friends/search?username=player
  router.get("/search", async (req, res) => {
    const currentUser = await getFriendRequestUser(req, res);
    if (!currentUser) return;

    const username =
      typeof req.query.username === "string"
        ? req.query.username.trim()
        : "";

    if (!username || username.length > 50) {
      return res.status(400).json({
        error: "Ievadiet derīgu lietotājvārdu.",
      });
    }

    try {
      const users = await prisma.user.findMany({
        where: {
          id: { not: currentUser.id },
          status: "ACTIVE",
          username: { contains: username },
        },
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true,
        },
        take: 20,
        orderBy: { username: "asc" },
      });

      const userIds = users.map((user) => user.id);

      const existing = userIds.length
        ? await prisma.friendship.findMany({
            where: {
              OR: [
                {
                  senderId: currentUser.id,
                  recipientId: { in: userIds },
                },
                {
                  recipientId: currentUser.id,
                  senderId: { in: userIds },
                },
              ],
            },
            select: {
              senderId: true,
              recipientId: true,
              status: true,
            },
          })
        : [];

      const friendshipByUser = new Map();

      for (const friendship of existing) {
        const otherId =
          friendship.senderId === currentUser.id
            ? friendship.recipientId
            : friendship.senderId;

        const direction =
          friendship.senderId === currentUser.id ? "OUTGOING" : "INCOMING";

        friendshipByUser.set(String(otherId), {
          status: friendship.status,
          direction,
        });
      }

      return res.json({
        users: users.map((user) => {
          const friendship = friendshipByUser.get(String(user.id));

          return {
            ...friendUser(user),
            friendshipStatus: friendship
              ? friendship.status === "PENDING"
                ? friendship.direction === "OUTGOING"
                  ? "PENDING"
                  : "INCOMING_PENDING"
                : friendship.status
              : null,
          };
        }),
      });
    } catch (error) {
      console.error("Friend search failed:", error);
      return res.status(500).json({
        error: "Neizdevās meklēt spēlētājus.",
      });
    }
  });

  // GET /api/friends
  router.get("/", async (req, res) => {
    const currentUser = await getFriendRequestUser(req, res);
    if (!currentUser) return;

    try {
      const friendships = await prisma.friendship.findMany({
        where: {
          OR: [
            { senderId: currentUser.id },
            { recipientId: currentUser.id },
          ],
          status: { in: ["PENDING", "ACCEPTED"] },
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            },
          },
          recipient: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const friends = [];
      const incoming = [];
      const outgoing = [];

      for (const friendship of friendships) {
        const sentByMe = friendship.senderId === currentUser.id;

        if (friendship.status === "ACCEPTED") {
          friends.push(
            friendUser(sentByMe ? friendship.recipient : friendship.sender),
          );
        } else if (sentByMe) {
          outgoing.push({
            id: String(friendship.id),
            recipient: friendUser(friendship.recipient),
            createdAt: friendship.createdAt,
          });
        } else {
          incoming.push({
            id: String(friendship.id),
            sender: friendUser(friendship.sender),
            createdAt: friendship.createdAt,
          });
        }
      }

      return res.json({ friends, incoming, outgoing });
    } catch (error) {
      console.error("Loading friends failed:", error);
      return res.status(500).json({
        error: "Neizdevās ielādēt draugu sarakstu.",
      });
    }
  });

  // DELETE /api/friends/:userId
  router.delete("/:userId", async (req, res) => {
    const currentUser = await getFriendRequestUser(req, res);
    if (!currentUser) return;

    const friendId = req.params.userId;
    if (!validDatabaseId(friendId)) {
      return res.status(400).json({ error: "Nederīgs spēlētāja ID." });
    }

    const targetId = BigInt(friendId);
    if (targetId === currentUser.id) {
      return res.status(400).json({ error: "Jūs nevarat noņemt sevi no draugiem." });
    }

    try {
      const result = await prisma.friendship.deleteMany({
        where: {
          status: "ACCEPTED",
          OR: [
            { senderId: currentUser.id, recipientId: targetId },
            { senderId: targetId, recipientId: currentUser.id },
          ],
        },
      });

      if (!result.count) {
        return res.status(404).json({ error: "Draugs nav atrasts." });
      }

      return res.json({ message: "Draugs ir noņemts." });
    } catch (error) {
      console.error("Removing friend failed:", error);
      return res.status(500).json({ error: "Neizdevās noņemt draugu." });
    }
  });

  // POST /api/friends/requests
  router.post("/requests", async (req, res) => {
    const currentUser = await getFriendRequestUser(req, res);
    if (!currentUser) return;

    const recipientId = req.body?.recipientId;

    if (!validDatabaseId(recipientId)) {
      return res.status(400).json({
        error: "Nederīgs spēlētāja ID.",
      });
    }

    const targetId = BigInt(recipientId);

    if (targetId === currentUser.id) {
      return res.status(400).json({
        error: "Jūs nevarat nosūtīt uzaicinājumu sev.",
      });
    }

    try {
      const recipient = await prisma.user.findFirst({
        where: {
          id: targetId,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      if (!recipient) {
        return res.status(404).json({
          error: "Spēlētājs nav atrasts.",
        });
      }

      const result = await prisma.$transaction(async (db) => {
        const existing = await db.friendship.findMany({
          where: {
            OR: [
              {
                senderId: currentUser.id,
                recipientId: targetId,
              },
              {
                senderId: targetId,
                recipientId: currentUser.id,
              },
            ],
          },
        });

        const accepted = existing.find(
          (friendship) => friendship.status === "ACCEPTED",
        );

        if (accepted) {
          return { kind: "already-friends" };
        }

        const myRequest = existing.find(
          (friendship) =>
            friendship.senderId === currentUser.id &&
            friendship.recipientId === targetId,
        );

        if (myRequest?.status === "PENDING") {
          return { kind: "already-sent" };
        }

        const reverseRequest = existing.find(
          (friendship) =>
            friendship.senderId === targetId &&
            friendship.recipientId === currentUser.id &&
            friendship.status === "PENDING",
        );

        // If they already invited me, accepting their request completes
        // the friendship instead of creating a duplicate reverse request.
        if (reverseRequest) {
          await db.friendship.update({
            where: { id: reverseRequest.id },
            data: { status: "ACCEPTED" },
          });

          return { kind: "accepted-reverse" };
        }

        // If a rejected request exists, remove it before sending again.
        // This avoids assuming the database enum has a REJECTED value.
        if (myRequest) {
          await db.friendship.delete({
            where: { id: myRequest.id },
          });
        }

        return {
          kind: "created",
          friendship: await db.friendship.create({
            data: {
              senderId: currentUser.id,
              recipientId: targetId,
            },
          }),
        };
      });

      if (result.kind === "already-friends") {
        return res.status(409).json({
          error: "Jūs jau esat draugi.",
        });
      }

      if (result.kind === "already-sent") {
        return res.status(409).json({
          error: "Uzaicinājums jau ir nosūtīts.",
        });
      }

      return res.status(result.kind === "created" ? 201 : 200).json({
        message:
          result.kind === "accepted-reverse"
            ? "Jūs tagad esat draugi!"
            : "Draudzības uzaicinājums nosūtīts.",
        status:
          result.kind === "accepted-reverse" ? "ACCEPTED" : "PENDING",
        ...(result.friendship
          ? { id: String(result.friendship.id) }
          : {}),
      });
    } catch (error) {
      if (error?.code === "P2002") {
        return res.status(409).json({
          error: "Šis draudzības uzaicinājums jau pastāv.",
        });
      }

      console.error("Sending friend request failed:", error);
      return res.status(500).json({
        error: "Neizdevās nosūtīt draudzības uzaicinājumu.",
      });
    }
  });

  // PATCH /api/friends/requests/:id
  // Body: { "decision": "accept" } or { "decision": "reject" }
  router.patch("/requests/:id", async (req, res) => {
    const currentUser = await getFriendRequestUser(req, res);
    if (!currentUser) return;

    const requestId = req.params.id;
    const decision = req.body?.decision;

    if (!validDatabaseId(requestId)) {
      return res.status(400).json({
        error: "Nederīgs uzaicinājuma ID.",
      });
    }

    if (decision !== "accept" && decision !== "reject") {
      return res.status(400).json({
        error: "Izvēlieties pieņemt vai noraidīt uzaicinājumu.",
      });
    }

    try {
      // Only the intended recipient may act on a pending request.
      const request = await prisma.friendship.findFirst({
        where: {
          id: BigInt(requestId),
          recipientId: currentUser.id,
          status: "PENDING",
        },
      });

      if (!request) {
        return res.status(404).json({
          error: "Uzaicinājums nav atrasts vai jau ir apstrādāts.",
        });
      }

      if (decision === "accept") {
        await prisma.friendship.update({
          where: { id: request.id },
          data: { status: "ACCEPTED" },
        });

        return res.json({
          message: "Uzaicinājums pieņemts.",
          status: "ACCEPTED",
        });
      }

      // Delete rejected requests rather than relying on a REJECTED enum
      // member that may not exist in the current Prisma schema.
      await prisma.friendship.delete({
        where: { id: request.id },
      });

      return res.json({
        message: "Uzaicinājums noraidīts.",
        status: "REJECTED",
      });
    } catch (error) {
      console.error("Responding to friend request failed:", error);
      return res.status(500).json({
        error: "Neizdevās apstrādāt uzaicinājumu.",
      });
    }
  });


  return router;
}
