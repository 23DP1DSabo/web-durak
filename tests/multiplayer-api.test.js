import { afterEach, beforeEach, expect, test } from "vitest";
import { createServer } from "node:http";
import { io as client } from "socket.io-client";
import { createAuthApp } from "../app.js";
import { attachRealtime } from "../lib/realtime.js";

// Transactional in-memory adapter: transport and authorization use the real app.
function database() {
  let rooms = [],
    players = [],
    next = 1n,
    queue = Promise.resolve();
  const hydrate = (r) =>
    r
      ? structuredClone({
          ...r,
          players: players
            .filter((p) => p.matchId === r.id)
            .sort((a, b) => Number(a.id - b.id))
            .map((p) => ({ ...p, user: null })),
        })
      : null;
  const matches = (r, w) => Object.entries(w).every(([k, v]) => r[k] === v);
  const patch = (r, data) => {
    for (const [k, v] of Object.entries(data))
      r[k] =
        v?.increment !== undefined ? r[k] + v.increment : structuredClone(v);
  };
  const db = {
    session: { findUnique: async () => null },
    match: {
      create: async ({ data }) => {
        const { players: ps, ...rest } = data;
        const r = {
          id: next++,
          version: 0,
          status: "WAITING",
          timeLimitSeconds: 600,
          gameState: null,
          createdAt: new Date(),
          ...rest,
        };
        rooms.push(r);
        if (ps)
          await db.matchPlayer.create({
            data: { matchId: r.id, ...ps.create },
          });
        return hydrate(r);
      },
      findUnique: async ({ where }) =>
        hydrate(rooms.find((r) => matches(r, where))),
      findMany: async ({ where }) =>
        rooms
          .filter(
            (r) =>
              (!where.status || r.status === where.status) &&
              (!where.mode || r.mode === where.mode) &&
              (!where.allowGuests || r.allowGuests),
          )
          .map(hydrate),
      updateMany: async ({ where, data }) => {
        const rows = rooms.filter((r) => matches(r, where));
        rows.forEach((r) => patch(r, data));
        return { count: rows.length };
      },
      update: async ({ where, data }) => {
        const r = rooms.find((r) => matches(r, where));
        patch(r, data);
        return hydrate(r);
      },
    },
    matchPlayer: {
      updateMany: async ({ where, data }) => {
        const rows = players.filter((p) => matches(p, where));
        for (const p of rows) Object.assign(p, structuredClone(data));
        return { count: rows.length };
      },
      create: async ({ data }) => {
        const p = { id: next++, userId: null, result: null, ...data };
        players.push(p);
        return structuredClone(p);
      },
      delete: async ({ where }) => {
        players = players.filter((p) => p.id !== where.id);
      },
      update: async ({ where, data }) => {
        const p = players.find((p) => p.id === where.id);
        Object.assign(p, data);
        return structuredClone(p);
      },
    },
  };
  db.$transaction = async (fn) => {
    const prev = queue;
    let release;
    queue = new Promise((r) => (release = r));
    await prev;
    const before = structuredClone({ rooms, players, next });
    try {
      return await fn(db);
    } catch (e) {
      ({ rooms, players, next } = before);
      throw e;
    } finally {
      release();
    }
  };
  return db;
}
let app, server, rt, base, db, sockets;
beforeEach(async () => {
  db = database();
  app = createAuthApp(db);
  server = createServer(app);
  rt = attachRealtime(server, app.locals.matches, {
    origin: "http://localhost:3000,http://192.168.1.105:3000",
    tickMs: 60000,
  });
  sockets = [];
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  sockets.forEach((s) => s.disconnect());
  rt.cleanup();
  await new Promise((r) => rt.io.close(r));
});
async function request(path, body, cookie, method = "POST", origin) {
  const r = await fetch(base + "/api/rooms" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function setup() {
  const a = await request("/", {
    code: "TESTROOM",
    mode: "classic",
    name: "Alice",
    allowGuests: true,
  });
  const b = await request("/TESTROOM/join", { name: "Bob" });
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  const start = await request("/TESTROOM/start", {}, a.cookie);
  expect(start.status).toBe(200);
  return { a, b };
}
async function connect(cookie, origin = "http://localhost:3000") {
  const s = client(base, {
    transports: ["websocket"],
    extraHeaders: { cookie, origin },
    reconnection: false,
  });
  sockets.push(s);
  await new Promise((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
const join = (s) =>
  s.timeout(3000).emitWithAck("game:join", { code: "TESTROOM" });

test("Socket.IO accepts each configured browser origin", async () => {
  const { a } = await setup();
  const socket = await connect(a.cookie, "http://192.168.1.105:3000");
  expect((await join(socket)).game.selfId).toBeTruthy();
});

test("two browsers receive shared moves, private hands and restored state after reconnect", async () => {
  const { a, b } = await setup();
  const sa = await connect(a.cookie),
    sb = await connect(b.cookie);
  const va = (await join(sa)).game,
    vb = (await join(sb)).game;
  expect(va.selfId).not.toBe(vb.selfId);
  expect(va.hand).not.toEqual(vb.hand);
  expect(va.players.every((p) => p.hand === undefined)).toBe(true);
  const attacker = va.actor === va.selfId ? sa : sb,
    defender = attacker === sa ? sb : sa;
  const v = attacker === sa ? va : vb;
  const pushed = new Promise((resolve) => defender.once("game:state", resolve));
  const result = await attacker.timeout(3000).emitWithAck("game:move", {
    version: v.version,
    move: { type: "attack", cardId: v.hand[0].id },
  });
  expect(result.game.attacks[0].id).toBe(v.hand[0].id);
  expect((await pushed).attacks).toEqual(result.game.attacks);
  const replay = await attacker.timeout(3000).emitWithAck("game:move", {
    version: v.version,
    move: { type: "attack", cardId: v.hand[0].id },
  });
  expect(replay.error).toBeTruthy();
  sa.disconnect();
  const restored = (await join(await connect(a.cookie))).game;
  expect(restored.attacks).toEqual(result.game.attacks);
  expect(restored.version).toBe(result.game.version);
  // A new service instance also restores the same persisted deck and hand.
  const otherApp = createAuthApp(db);
  const room = await otherApp.locals.matches.load("TESTROOM");
  const identity = await otherApp.locals.matches.identity({
    headers: { cookie: a.cookie },
  });
  expect(otherApp.locals.matches.view(room, identity).hand).toEqual(
    restored.hand,
  );
});
test("public IDs cannot impersonate members; outsiders, cross-origin actions and forged finishes fail", async () => {
  const { a, b } = await setup();
  const publicData = await request("/TESTROOM", undefined, undefined, "GET");
  expect(publicData.body.room.selfId).toBeNull();
  expect(JSON.stringify(publicData.body)).not.toContain("playerKey");
  const stolen = publicData.body.room.hostId;
  expect((await request("/TESTROOM/finish", { playerId: stolen })).status).toBe(
    403,
  );
  expect((await request("/TESTROOM/finish", {}, a.cookie)).status).toBe(403);
  expect(
    (
      await request(
        "/TESTROOM/leave",
        {},
        a.cookie,
        "POST",
        "https://evil.invalid",
      )
    ).status,
  ).toBe(403);
  const outsider = await connect(publicData.cookie);
  expect((await join(outsider)).error).toBeTruthy();
  await expect(connect(a.cookie, "https://evil.invalid")).rejects.toThrow();
  const sb = await connect(b.cookie);
  const v = (await join(sb)).game;
  const finish = await sb
    .timeout(3000)
    .emitWithAck("game:move", { version: v.version, move: { type: "resign" } });
  expect(finish.game.result.loser).toBe(v.selfId);
  const saved = await db.match.findUnique({ where: { roomCode: "TESTROOM" } });
  expect(saved.status).toBe("FINISHED");
  expect(saved.players.map((p) => p.result).sort()).toEqual(["DURAK", "WIN"]);
});
test("concurrent commands based on one version commit only once", async () => {
  const { a, b } = await setup();
  const s = await connect(a.cookie),
    v = (await join(s)).game;
  const service = app.locals.matches,
    who = await service.identity({ headers: { cookie: a.cookie } });
  const results = await Promise.allSettled([
    service.action("TESTROOM", who, { type: "resign" }, v.version),
    service.action("TESTROOM", who, { type: "resign" }, v.version),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await service.load("TESTROOM")).version).toBe(v.version + 1);
});
test("host authorization uses cookies and starting alone retains solo mode", async () => {
  const a = await request("/", {
    code: "SOLOGAME",
    mode: "classic",
    name: "Alice",
    allowGuests: true,
  });
  expect(
    (await request("/SOLOGAME/start", { playerId: a.body.room.hostId })).status,
  ).toBe(403);
  const start = await request("/SOLOGAME/start", {}, a.cookie);
  expect(start.body.room.multiplayer).toBe(false);
  expect((await request("/SOLOGAME/finish", {}, a.cookie)).status).toBe(200);
});

test("room capacity and host-only settings remain enforced", async () => {
  const a = await request("/", {
    code: "FULLROOM",
    mode: "passing",
    name: "Host",
    allowGuests: true,
  });
  const guests = [];
  for (let i = 0; i < 5; i++)
    guests.push(await request("/FULLROOM/join", { name: `Guest ${i}` }));
  expect(guests.every((r) => r.status === 200)).toBe(true);
  expect((await request("/FULLROOM/join", { name: "Seventh" })).status).toBe(
    409,
  );
  expect(
    (
      await request(
        "/FULLROOM/settings",
        { timeLimitSeconds: 60 },
        guests[0].cookie,
        "PATCH",
      )
    ).status,
  ).toBe(403);
  expect((await request("/FULLROOM/start", {}, guests[0].cookie)).status).toBe(
    403,
  );
  const started = await request("/FULLROOM/start", {}, a.cookie);
  expect(started.body.room.players).toHaveLength(6);
  expect((await request("/FULLROOM/join", { name: "Late" })).status).toBe(409);
  expect(
    (await request("/FULLROOM/game", undefined, undefined, "GET")).status,
  ).toBe(403);
});
test("room settings accept no time limit and the server never expires that match", async () => {
  const a = await request("/", {
    code: "NOTIMELM",
    mode: "classic",
    name: "Host",
    allowGuests: true,
  });
  const b = await request("/NOTIMELM/join", { name: "Guest" });
  const setting = await request(
    "/NOTIMELM/settings",
    { timeLimitSeconds: 0 },
    a.cookie,
    "PATCH",
  );
  expect(setting.status).toBe(200);
  expect(setting.body.room.timeLimitSeconds).toBe(0);

  const started = await request("/NOTIMELM/start", {}, a.cookie);
  expect(started.status).toBe(200);
  const room = await app.locals.matches.load("NOTIMELM");
  expect(room.gameState.timed).toBe(false);

  await db.match.update({
    where: { id: room.id },
    data: {
      gameState: { ...room.gameState, updatedAt: Date.now() - 1000000000 },
    },
  });
  await app.locals.matches.expire();
  const activeRoom = await app.locals.matches.load("NOTIMELM");
  expect(activeRoom.status).toBe("ACTIVE");
  expect(activeRoom.gameState.result).toBeNull();
  expect(b.status).toBe(200);
});
test("timeout maintenance finishes a disconnected game and saves the loser", async () => {
  const { a } = await setup();
  const room = await app.locals.matches.load("TESTROOM");
  const state = structuredClone(room.gameState);
  state.updatedAt = Date.now() - 700000;
  const loser = state.phase === "defend" ? state.defender : state.attacker;
  await db.match.update({ where: { id: room.id }, data: { gameState: state } });
  await app.locals.matches.expire();
  const ended = await app.locals.matches.load("TESTROOM");
  expect(ended.status).toBe("FINISHED");
  expect(ended.gameState.result).toMatchObject({ loser, reason: "timeout" });
  expect(ended.players.find((p) => String(p.id) === loser).result).toBe(
    "DURAK",
  );
});

test("concurrent ordinary moves commit once even without a multi-statement transaction", async () => {
  const { a, b } = await setup();
  const service = app.locals.matches;
  const room = await service.load("TESTROOM");
  const cookie =
    room.gameState.attacker === a.body.room.selfId ? a.cookie : b.cookie;
  const who = await service.identity({ headers: { cookie } });
  const view = service.view(room, who);
  const move = { type: "attack", cardId: view.hand[0].id };
  const results = await Promise.allSettled([
    service.action("TESTROOM", who, move, room.version),
    service.action("TESTROOM", who, move, room.version),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const saved = await service.load("TESTROOM");
  expect(saved.version).toBe(room.version + 1);
  expect(saved.gameState.attacks).toHaveLength(1);
});

test("a failed save never broadcasts or acknowledges an unpersisted move", async () => {
  const { a, b } = await setup();
  const service = app.locals.matches;
  const room = await service.load("TESTROOM");
  const cookie =
    room.gameState.attacker === a.body.room.selfId ? a.cookie : b.cookie;
  const who = await service.identity({ headers: { cookie } });
  const view = service.view(room, who);
  let broadcasts = 0;
  const onChange = () => broadcasts++;
  service.events.on("changed", onChange);
  const update = db.match.updateMany;
  db.match.updateMany = async () => {
    throw new Error("Database unavailable");
  };
  try {
    await expect(
      service.action(
        "TESTROOM",
        who,
        { type: "attack", cardId: view.hand[0].id },
        room.version,
      ),
    ).rejects.toThrow("Database unavailable");
    expect(broadcasts).toBe(0);
    expect((await service.load("TESTROOM")).gameState).toEqual(room.gameState);
  } finally {
    db.match.updateMany = update;
    service.events.off("changed", onChange);
  }
});

test("an old server snapshot cannot overwrite a newer committed move", async () => {
  const { a, b } = await setup();
  const service = app.locals.matches;
  const room = await service.load("TESTROOM");
  const cookie =
    room.gameState.attacker === a.body.room.selfId ? a.cookie : b.cookie;
  const who = await service.identity({ headers: { cookie } });
  const view = service.view(room, who);
  const move = { type: "attack", cardId: view.hand[0].id };
  const saved = await service.action("TESTROOM", who, move, room.version, room);
  await expect(
    service.action("TESTROOM", who, move, room.version, room),
  ).rejects.toThrow();
  const restored = await service.load("TESTROOM");
  expect(restored.version).toBe(saved.version);
  expect(restored.gameState).toEqual(saved.gameState);
});

test.each(["committed change", "server restart"])(
  "disconnected games expire from their deadline after %s",
  async (source) => {
    await setup();
    const service = app.locals.matches;
    const room = await service.load("TESTROOM");
    const game = structuredClone(room.gameState);
    game.updatedAt = Date.now();
    for (const p of game.players) p.remainingMs = 50;
    const updated = await db.match.update({
      where: { id: room.id },
      data: { gameState: game, version: { increment: 1 } },
    });
    if (source === "server restart") {
      rt.cleanup();
      await new Promise((resolve) => rt.io.close(resolve));
      server = createServer(app);
      rt = attachRealtime(server, service, { tickMs: 60000 });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    } else service.events.emit("changed", "TESTROOM", updated);
    await expect
      .poll(async () => (await service.load("TESTROOM")).status, {
        timeout: 3000,
      })
      .toBe("FINISHED");
    const ended = await service.load("TESTROOM");
    expect(ended.gameState.result.reason).toBe("timeout");
    expect(ended.players.map((p) => p.result).sort()).toEqual(["DURAK", "WIN"]);
  },
);

test("removed DuraKlash mode is rejected by room creation and quickplay", async () => {
  const body = {
    code: "OLDMODE1",
    mode: "duraklash",
    name: "Player",
    allowGuests: true,
  };
  expect((await request("/", body)).status).toBe(400);
  expect((await request("/quickplay", body)).status).toBe(400);
  expect(
    await db.match.findUnique({ where: { roomCode: body.code } }),
  ).toBeNull();
});

test("simultaneous throw-in and targeted defense both persist, but stale actions cannot cross bouts", async () => {
  const { a, b } = await setup();
  const service = app.locals.matches;
  let room = await service.load("TESTROOM");
  const g = structuredClone(room.gameState);
  const hostId = a.body.room.selfId,
    guestId = b.body.room.selfId;
  g.attacker = hostId;
  g.defender = guestId;
  g.trumpSuit = "spades";
  g.players.find((p) => p.id === hostId).hand = [
    { id: "a", rank: 6, suit: "clubs" },
    { id: "b", rank: 6, suit: "hearts" },
    { id: "spare", rank: 10, suit: "clubs" },
  ];
  g.players.find((p) => p.id === guestId).hand = [
    { id: "c", rank: 7, suit: "clubs" },
    { id: "d", rank: 8, suit: "hearts" },
    { id: "e", rank: 9, suit: "clubs" },
  ];
  await db.match.update({ where: { id: room.id }, data: { gameState: g } });
  const who = await service.identity({ headers: { cookie: a.cookie } });
  room = await service.action(
    "TESTROOM",
    who,
    { type: "attack", cardId: "a", bout: 0 },
    room.version,
  );
  const sa = await connect(a.cookie),
    sb = await connect(b.cookie);
  const va = (await join(sa)).game,
    vb = (await join(sb)).game;
  const responses = await Promise.all([
    sa
      .timeout(3000)
      .emitWithAck("game:move", {
        version: va.version,
        move: { type: "attack", cardId: "b", bout: va.bout },
      }),
    sb
      .timeout(3000)
      .emitWithAck("game:move", {
        version: vb.version,
        move: { type: "defend", cardId: "c", targetId: "a", bout: vb.bout },
      }),
  ]);
  expect(responses.every((r) => !r.error)).toBe(true);
  const saved = await service.load("TESTROOM");
  expect(saved.version).toBe(room.version + 2);
  expect(saved.gameState.attacks.map((c) => c.id)).toEqual(["a", "b"]);
  expect(saved.gameState.defenses.map((c) => c?.id ?? null)).toEqual([
    "c",
    null,
  ]);
  const defender = await service.identity({ headers: { cookie: b.cookie } });
  const taking = await service.action(
    "TESTROOM",
    defender,
    { type: "take", bout: 0 },
    saved.version,
  );
  const ended = await service.action(
    "TESTROOM",
    who,
    { type: "finish", bout: 0 },
    taking.version,
  );
  expect(ended.gameState.bout).toBe(1);
  await expect(
    service.action(
      "TESTROOM",
      who,
      { type: "attack", cardId: "spare", bout: 0 },
      saved.version,
    ),
  ).rejects.toThrow();
});


async function setupMany(count) {
  const members = [await request("/", {
    code: "TESTROOM", mode: "classic", name: "Host", allowGuests: true,
  })];
  for (let i = 1; i < count; i++) {
    members.push(await request("/TESTROOM/join", { name: `Player ${i + 1}` }));
  }
  expect((await request("/TESTROOM/start", {}, members[0].cookie)).status).toBe(200);
  return members;
}

test("host resignation keeps a three-player match active, broadcasts it and persists only their loss", async () => {
  const [a, b, c] = await setupMany(3);
  const service = app.locals.matches;
  const sb = await connect(b.cookie);
  await join(sb);
  const change = new Promise((resolve) => sb.once("game:state", resolve));
  expect((await request("/TESTROOM/leave", {}, a.cookie)).status).toBe(200);
  const view = await change;
  expect(view.result).toBeNull();
  expect(view.players.find((p) => p.id === a.body.room.selfId)).toMatchObject({ out: true, exitReason: "resign" });
  let room = await service.load("TESTROOM");
  expect(room.status).toBe("ACTIVE");
  expect(room.players.map((p) => p.result)).toEqual(["DURAK", null, null]);
  const restored = (await request("/TESTROOM/game", undefined, a.cookie, "GET")).body.game;
  expect(restored.legal).toMatchObject({ attack: [], defend: [], finish: false });
  const end = await sb.timeout(3000).emitWithAck("game:move", {
    version: view.version, move: { type: "resign" },
  });
  expect(end.error).toBeUndefined();
  expect(end.game.result.winners).toEqual([c.body.room.selfId]);
  expect(end.game.result.losers).toEqual([a.body.room.selfId, b.body.room.selfId]);
  room = await service.load("TESTROOM");
  expect(room.status).toBe("FINISHED");
  expect(room.players.map((p) => p.result)).toEqual(["DURAK", "DURAK", "WIN"]);
});

test("resignation rolls back game state and does not broadcast if writing the loss fails", async () => {
  const [a] = await setupMany(3);
  const service = app.locals.matches;
  const before = await service.load("TESTROOM");
  const who = await service.identity({ headers: { cookie: a.cookie } });
  let broadcasts = 0;
  service.events.on("changed", () => broadcasts++);
  db.matchPlayer.updateMany = async () => { throw new Error("Result write failed"); };
  await expect(service.action("TESTROOM", who, { type: "resign" }, before.version)).rejects.toThrow("Result write failed");
  const after = await service.load("TESTROOM");
  expect(after.gameState).toEqual(before.gameState);
  expect(after.version).toBe(before.version);
  expect(after.players.map((p) => p.result)).toEqual([null, null, null]);
  expect(broadcasts).toBe(0);
});

test("server rejects early and non-neighbour throw-ins, including stale rebased moves after handoff", async () => {
  const members = await setupMany(4);
  const service = app.locals.matches;
  const identities = await Promise.all(members.map((m) => service.identity({ headers: { cookie: m.cookie } })));
  let room = await service.load("TESTROOM");
  const g = structuredClone(room.gameState);
  const ids = members.map((m) => m.body.room.selfId);
  g.attacker = ids[0];
  g.defender = ids[1];
  g.players[0].hand = [{ id: "a", rank: 6, suit: "clubs" }, { id: "b", rank: 6, suit: "hearts" }];
  g.players[2].hand = [{ id: "c", rank: 6, suit: "diamonds" }];
  g.players[3].hand = [{ id: "d", rank: 6, suit: "spades" }];
  await db.match.update({ where: { id: room.id }, data: { gameState: g } });
  room = await service.action("TESTROOM", identities[0], { type: "attack", cardId: "a", bout: 0 }, room.version);
  const previousVersion = room.version;
  await expect(service.action("TESTROOM", identities[2], { type: "attack", cardId: "c", bout: 0 }, room.version)).rejects.toThrow();
  await expect(service.action("TESTROOM", identities[3], { type: "attack", cardId: "d", bout: 0 }, room.version)).rejects.toThrow();
  room = await service.action("TESTROOM", identities[0], { type: "finish", bout: 0 }, room.version);
  await expect(service.action("TESTROOM", identities[0], { type: "attack", cardId: "b", bout: 0 }, previousVersion)).rejects.toThrow();
  room = await service.action("TESTROOM", identities[2], { type: "attack", cardId: "c", bout: 0 }, room.version);
  expect(room.gameState.attacks.map((c) => c.id)).toEqual(["a", "c"]);
  expect(room.gameState.finishedAttackers).toEqual([ids[0]]);
  await expect(service.action("TESTROOM", identities[3], { type: "finish", bout: 0 }, room.version)).rejects.toThrow();
});


test("a three-player timeout stays active and records the loss through final completion", async () => {
  const members = await setupMany(3);
  const service = app.locals.matches;
  let room = await service.load("TESTROOM");
  const state = structuredClone(room.gameState);
  const expiredId = state.attacker;
  state.updatedAt = Date.now() - 700000;
  await db.match.update({ where: { id: room.id }, data: { gameState: state } });
  await service.expire();
  room = await service.load("TESTROOM");
  expect(room.status).toBe("ACTIVE");
  expect(room.gameState.result).toBeNull();
  expect(room.gameState.players.find((p) => p.id === expiredId)).toMatchObject({ out: true, exitReason: "timeout" });
  expect(room.players.find((p) => String(p.id) === expiredId).result).toBe("DURAK");
  expect(room.players.filter((p) => String(p.id) !== expiredId).map((p) => p.result)).toEqual([null, null]);
  const survivor = members.find((m) => m.body.room.selfId !== expiredId);
  const who = await service.identity({ headers: { cookie: survivor.cookie } });
  room = await service.action("TESTROOM", who, { type: "resign" }, room.version);
  expect(room.status).toBe("FINISHED");
  expect(room.gameState.result.losers).toContain(expiredId);
  expect(room.players.map((p) => p.result).sort()).toEqual(["DURAK", "DURAK", "WIN"]);
});
