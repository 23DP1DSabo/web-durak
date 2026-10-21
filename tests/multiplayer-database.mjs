import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { io as client } from "socket.io-client";
import { createAuthApp } from "../app.js";
import { attachRealtime } from "../lib/realtime.js";
import { prisma } from "../lib/prisma.ts";

const code = "T" + randomBytes(4).toString("hex").slice(0, 7).toUpperCase();
const app = createAuthApp(prisma),
  server = createServer(app);
const realtime = attachRealtime(server, app.locals.matches, { tickMs: 60000 });
const sockets = [];
const timings = [];
const timed = async (label, operation) => {
  const start = performance.now();
  const result = await operation();
  timings.push({ operation: label, ms: Math.round(performance.now() - start) });
  return result;
};
const accounts = [];
let createdId;
try {
  const identities = [];
  if (process.env.DURAK_AUTH_BENCHMARK === "1") {
    for (let i = 0; i < 2; i++) {
      const username = `perf_${code}_${i}`;
      const user = await prisma.user.create({
        data: {
          username,
          email: `${username}@example.invalid`,
          name: "Performance check",
          passwordHash: "test-only-no-login",
        },
      });
      accounts.push(user);
      const token = randomBytes(32).toString("hex");
      await prisma.session.create({
        data: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          userId: user.id,
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      identities.push(`durak_session=${token}`);
    }
  }
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, cookie) {
    const started = performance.now();
    const res = await fetch(base + "/api/rooms" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    assert.ok(res.ok, JSON.stringify(data));
    timings.push({
      operation: path === "/" ? "create room" : path.split("/").at(-1),
      ms: Math.round(performance.now() - started),
    });
    return {
      ...data,
      cookie: [cookie, res.headers.get("set-cookie")?.split(";")[0]]
        .filter(Boolean)
        .join("; "),
    };
  }
  async function connect(cookie) {
    const s = client(base, {
      transports: ["websocket"],
      extraHeaders: {
        cookie,
        origin: process.env.APP_ORIGIN || "http://localhost:3000",
      },
      reconnection: false,
    });
    sockets.push(s);
    await new Promise((r, j) => {
      s.once("connect", r);
      s.once("connect_error", j);
    });
    const data = await s.timeout(10000).emitWithAck("game:join", { code });
    assert.ok(!data.error, data.error);
    return { socket: s, game: data.game };
  }
  const a = await post(
    "/",
    {
      code,
      mode: "classic",
      name: "Multiplayer QA A",
      allowGuests: true,
    },
    identities[0],
  );
  createdId = (await prisma.match.findUnique({ where: { roomCode: code } })).id;
  const b = await post(
    `/${code}/join`,
    { name: "Multiplayer QA B" },
    identities[1],
  );
  if (accounts.length)
    assert.deepEqual(
      b.room.players.map((p) => p.name),
      accounts.map((u) => u.username),
    );
  await post(`/${code}/start`, {}, a.cookie);
  const sa = await connect(a.cookie),
    sb = await connect(b.cookie);
  assert.notEqual(sa.game.selfId, sb.game.selfId);
  assert.notDeepEqual(sa.game.hand, sb.game.hand);
  const current = sa.game.actor === sa.game.selfId ? sa : sb;
  const result = await timed("attack", () =>
    current.socket.timeout(15000).emitWithAck("game:move", {
      version: current.game.version,
      move: { type: "attack", cardId: current.game.hand[0].id },
    }),
  );
  assert.ok(!result.error, result.error);
  assert.equal(result.game.attacks.length, 1);
  const duplicate = await current.socket
    .timeout(10000)
    .emitWithAck("game:move", {
      version: current.game.version,
      move: { type: "attack", cardId: current.game.hand[0].id },
    });
  assert.ok(duplicate.error);
  sa.socket.disconnect();
  const reconnected = await connect(a.cookie);
  assert.deepEqual(reconnected.game.attacks, result.game.attacks);
  const finish = await reconnected.socket
    .timeout(10000)
    .emitWithAck("game:move", {
      version: reconnected.game.version,
      move: { type: "resign" },
    });
  assert.ok(!finish.error, finish.error);
  const saved = await prisma.match.findUnique({
    where: { id: createdId },
    include: { players: true },
  });
  assert.equal(saved.status, "FINISHED");
  assert.ok(saved.gameState.result);
  assert.deepEqual(saved.players.map((p) => p.result).sort(), ["DURAK", "WIN"]);
  if (accounts.length) {
    await prisma.session.deleteMany({ where: { userId: accounts[0].id } });
    const revoked = await reconnected.socket
      .timeout(10000)
      .emitWithAck("game:join", { code });
    assert.equal(revoked.status, 401);
  }
  if (process.env.DURAK_BENCHMARK === "1")
    console.log(JSON.stringify({ timings }));
  console.log(
    "PASS: real MySQL room, two Socket.IO clients, private hands, shared move, stale move rejection, reconnect, persisted results.",
  );
} finally {
  for (const s of sockets) s.disconnect();
  realtime.cleanup();
  await new Promise((r) => realtime.io.close(r));
  try {
    if (createdId)
      await prisma.match.deleteMany({
        where: { id: createdId, roomCode: code },
      });
    for (const user of accounts)
      await prisma.user.deleteMany({
        where: { id: user.id, username: user.username },
      });
  } finally {
    await prisma.$disconnect();
  }
}
