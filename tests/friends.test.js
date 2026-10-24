import { createHash } from "node:crypto";
import express from "express";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createFriendsRouter } from "../router/friends.js";

let server;
let base;
let friendships;
const sessionToken = "a".repeat(64);
const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
const currentUser = {
  id: 1n,
  username: "current",
  status: "ACTIVE",
};

beforeEach(async () => {
  friendships = [
    { id: 10n, senderId: 1n, recipientId: 2n, status: "ACCEPTED" },
    { id: 11n, senderId: 3n, recipientId: 1n, status: "ACCEPTED" },
    { id: 12n, senderId: 1n, recipientId: 4n, status: "PENDING" },
  ];

  const prisma = {
    session: {
      findUnique: async ({ where }) =>
        where.tokenHash === tokenHash
          ? {
              tokenHash,
              expiresAt: new Date(Date.now() + 60_000),
              user: currentUser,
            }
          : null,
      deleteMany: async () => ({ count: 0 }),
    },
    friendship: {
      deleteMany: async ({ where }) => {
        const removed = friendships.filter((friendship) =>
          friendship.status === where.status
          && where.OR.some((condition) =>
            friendship.senderId === condition.senderId
            && friendship.recipientId === condition.recipientId
          )
        );
        friendships = friendships.filter((friendship) => !removed.includes(friendship));
        return { count: removed.length };
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/friends",
    createFriendsRouter(prisma, {
      getSessionToken: (req) => {
        const cookie = req.headers.cookie
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("durak_session="));
        return cookie?.slice("durak_session=".length) ?? null;
      },
      clearSessionCookie: (res) => res.setHeader("Set-Cookie", "durak_session=; Max-Age=0"),
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function removeFriend(friendId, authenticated = true) {
  return fetch(`${base}/api/friends/${friendId}`, {
    method: "DELETE",
    ...(authenticated ? { headers: { cookie: `durak_session=${sessionToken}` } } : {}),
  });
}

test("authenticated user can remove an accepted friend in either direction", async () => {
  const response = await removeFriend("3");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: "Draugs ir noņemts." });
  expect(friendships.map(({ id }) => id)).toEqual([10n, 12n]);
});

test("friend removal requires authentication and only removes accepted friendships", async () => {
  expect((await removeFriend("2", false)).status).toBe(401);
  expect((await removeFriend("4")).status).toBe(404);
  expect((await removeFriend("1")).status).toBe(400);
  expect(friendships).toHaveLength(3);
});
