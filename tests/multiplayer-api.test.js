import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { io as client } from "socket.io-client";
import { createAuthApp } from "../app.js";
import { attachRealtime } from "../lib/realtime.js";

// Transactional in-memory adapter: transport and authorization use the real app.
function database() {
  let rounds = [], rooms = [],
    players = [],
    next = 1n,
    queue = Promise.resolve();
  // Signed-in users for invitation tests; every other test plays as guests.
  const accounts = [], sessions = new Map(), friendships = [];
  const account = (id) => accounts.find((a) => a.id === id) ?? null;
  const hydrate = (r) =>
    r
      ? structuredClone({
          ...r,
          players: players
            .filter((p) => p.matchId === r.id)
            .sort((a, b) => Number(a.id - b.id))
            .map((p) => ({ ...p, user: account(p.userId) })),
        })
      : null;
  const inMatchWith = (p, filter) => {
    const status = rooms.find((r) => r.id === p.matchId)?.status;
    return !filter || (filter.in ? filter.in.includes(status) : status === filter);
  };
  const matches = (r, w) => Object.entries(w).every(([k, v]) =>
    v && typeof v === "object" && Array.isArray(v.in) ? v.in.includes(r[k]) : r[k] === v);
  const patch = (r, data) => {
    for (const [k, v] of Object.entries(data))
      r[k] =
        v?.increment !== undefined ? r[k] + v.increment : structuredClone(v);
  };
  const db = {
    accounts, sessions, friendships,
    history: () => structuredClone(rounds),
    friendship: {
      findFirst: async ({ where }) => {
        const f = friendships.find((f) => f.status === where.status && where.OR.some((pair) =>
          f.senderId === pair.senderId && f.recipientId === pair.recipientId));
        return f ? { ...f, sender: account(f.senderId), recipient: account(f.recipientId) } : null;
      },
    },
    matchRound: { upsert: async ({ create }) => {
      const existing = rounds.find((round) => round.matchId === create.matchId && +round.startedAt === +create.startedAt);
      if (existing) return existing;
      rounds.push(structuredClone(create));
      return create;
    } },
    session: {
      findUnique: async ({ where }) => {
        const s = sessions.get(where.tokenHash);
        return s ? { ...s, tokenHash: where.tokenHash, user: account(s.userId) } : null;
      },
    },
    match: {
      create: async ({ data }) => {
        if (rooms.some((r) => r.roomCode === data.roomCode)) {
          throw Object.assign(new Error("Duplicate room code"), { code: "P2002" });
        }
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
        if (ps) {
          for (const data of Array.isArray(ps.create) ? ps.create : [ps.create]) {
            await db.matchPlayer.create({ data: { matchId: r.id, ...data } });
          }
        }
        return hydrate(r);
      },
      findUnique: async ({ where }) =>
        hydrate(rooms.find((r) => matches(r, where))),
      findMany: async ({ where }) =>
        rooms
          .filter(
            (r) =>
              (!where.status || (where.status.in
                ? where.status.in.includes(r.status)
                : r.status === where.status)) &&
              (!where.createdAt?.lt || r.createdAt < where.createdAt.lt) &&
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
      findFirst: async ({ where }) =>
        players.find((p) => p.userId === where.userId && inMatchWith(p, where.match?.is.status)) ?? null,
      findMany: async ({ where }) => players
        .filter((p) => p.userId === where.userId && inMatchWith(p, where.match?.is.status))
        .map((p) => ({ match: rooms.find((r) => r.id === p.matchId) })),
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
    const before = structuredClone({ rooms, players, rounds, next });
    try {
      return await fn(db);
    } catch (e) {
      ({ rooms, players, rounds, next } = before);
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
    invites: app.locals.invites,
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

test("rooms nobody has viewed for 10 minutes are closed, except multiplayer games", async () => {
  await setup();
  const lobby = await request("/", { code: "LOBBYAAA", mode: "classic", name: "Lobby host" });
  const solo = await request("/", { code: "BOTGAMEA", mode: "classic", name: "Solo" });
  await request("/BOTGAMEA/start", {}, solo.cookie);
  const viewed = await request("/", { code: "VIEWEDAA", mode: "classic", name: "Viewer" });
  const matches = app.locals.matches;
  expect(await matches.sweepAbandoned()).toEqual([]); // Restart grace period.

  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect((await request("/VIEWEDAA", undefined, viewed.cookie, "GET")).status).toBe(200);
    // An outsider's view does not keep a room alive.
    await request("/LOBBYAAA", undefined, undefined, "GET");
    expect((await matches.sweepAbandoned()).sort()).toEqual(["BOTGAMEA", "LOBBYAAA"]);
    expect((await matches.load("TESTROOM")).status).toBe("ACTIVE");
    expect((await matches.load("VIEWEDAA")).status).toBe("WAITING");
    expect((await request("/LOBBYAAA", undefined, lobby.cookie, "GET")).body.room.status).toBe("finished");

    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await matches.sweepAbandoned()).toEqual(["VIEWEDAA"]);
  } finally {
    vi.useRealTimers();
  }
});

function signIn(id, username) {
  const token = createHash("sha256").update(username).digest("hex");
  db.accounts.push({ id, username, status: "ACTIVE" });
  db.sessions.set(createHash("sha256").update(token).digest("hex"), {
    userId: id, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return `durak_session=${token}; durak_guest=${"0".repeat(63)}${id % 10n}`;
}
const nextEvent = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
async function subscribe(cookie) {
  const socket = await connect(cookie);
  const ack = await socket.timeout(3000).emitWithAck("invites:subscribe", {});
  return { socket, ack };
}

test("friends are invited live; rejecting notifies the inviter and accepting moves the friend", async () => {
  const anna = signIn(1001n, "anna"), bob = signIn(1002n, "bob"), cat = signIn(1003n, "cat");
  db.friendships.push({ senderId: 1001n, recipientId: 1002n, status: "ACCEPTED" });
  expect((await request("/", { code: "ANNAROOM", mode: "passing", name: "x" }, anna)).status).toBe(201);
  const invite = (cookie, friendId = "1002") => request("/ANNAROOM/invites", { friendId }, cookie);

  expect((await invite(anna)).body.error).toBe("bob pašlaik nav tiešsaistē.");
  expect((await invite(anna, "1003")).status).toBe(404); // Not a friend.
  expect((await invite(undefined)).status).toBe(401); // Guests have no friends.
  expect((await invite(cat)).status).toBe(403); // Not in the room.

  const inviter = await subscribe(anna);
  const invitee = await subscribe(bob);
  expect(invitee.ack).toEqual({ invites: [] });
  let received = nextEvent(invitee.socket, "invite:received");
  expect((await invite(anna)).status).toBe(201);
  const first = await received;
  expect(first).toMatchObject({ roomCode: "ANNAROOM", mode: "passing", fromName: "anna" });
  expect((await invite(anna)).status).toBe(409); // Already pending.

  const rejected = nextEvent(inviter.socket, "invite:rejected");
  const closed = nextEvent(invitee.socket, "invite:closed");
  expect((await request(`/invites/${first.id}/reject`, {}, bob)).status).toBe(200);
  expect(await rejected).toEqual({ toName: "bob", roomCode: "ANNAROOM" });
  expect(await closed).toEqual({ id: first.id });
  expect((await request(`/invites/${first.id}/accept`, {}, bob)).status).toBe(404);

  // Bob waits in his own lobby; accepting leaves it, which closes it as host.
  expect((await request("/", { code: "BOBSROOM", mode: "classic", name: "x" }, bob)).status).toBe(201);
  received = nextEvent(invitee.socket, "invite:received");
  await invite(anna);
  const second = await received;
  expect((await request(`/invites/${second.id}/accept`, {}, anna)).status).toBe(404); // Not theirs.
  const accepted = await request(`/invites/${second.id}/accept`, {}, bob);
  expect(accepted.status).toBe(200);
  expect(accepted.body.room.players.map((p) => p.name)).toEqual(["anna", "bob"]);
  expect(accepted.body.room.selfId).toBe(accepted.body.room.players[1].id);
  expect((await app.locals.matches.load("BOBSROOM")).status).toBe("FINISHED");
  expect((await invite(anna)).body.error).toBe("Draugs jau ir šajā istabā.");
});

test("friends in an active game are not invited", async () => {
  const anna = signIn(1001n, "anna"), bob = signIn(1002n, "bob");
  db.friendships.push({ senderId: 1002n, recipientId: 1001n, status: "ACCEPTED" });
  await request("/", { code: "ANNAROOM", mode: "classic", name: "x" }, anna);
  await request("/", { code: "BOTGAMEB", mode: "classic", name: "x" }, bob);
  await request("/BOTGAMEB/start", {}, bob);
  await subscribe(bob);
  const response = await request("/ANNAROOM/invites", { friendId: "1002" }, anna);
  expect(response.body.error).toBe("bob pašlaik spēlē.");
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
  state.players.find((p) => p.id === loser).movesMade = 1;
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
    for (const p of game.players) { p.remainingMs = 50; p.movesMade = 1; }
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
  room = await service.action("TESTROOM", identities[0], { type: "attack", cardId: "b", bout: 0 }, previousVersion);
  room = await service.action("TESTROOM", identities[2], { type: "attack", cardId: "c", bout: 0 }, room.version);
  expect(room.gameState.attacks.map((c) => c.id)).toEqual(["a", "b", "c"]);
  expect(room.gameState.finishedAttackers).toEqual([]);
  await expect(service.action("TESTROOM", identities[3], { type: "finish", bout: 0 }, room.version)).rejects.toThrow();
});


test("a three-player timeout stays active and records the loss through final completion", async () => {
  const members = await setupMany(3);
  const service = app.locals.matches;
  let room = await service.load("TESTROOM");
  const state = structuredClone(room.gameState);
  const expiredId = state.attacker;
  state.players.find((p) => p.id === expiredId).movesMade = 1;
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


test("room creation retries preserve the original host and settings; a collision cannot steal a room", async () => {
  const body = { code: "RETRY123", mode: "classic", name: "Host", allowGuests: true };
  const created = await request("/", body);
  expect(created.status).toBe(201);
  await request("/RETRY123/settings", { timeLimitSeconds: 60, allowGuests: false }, created.cookie, "PATCH");
  const repeated = await request("/", body, created.cookie);
  expect(repeated.status).toBe(200);
  expect(repeated.body.room).toMatchObject({ hostId: created.body.room.hostId, timeLimitSeconds: 60, allowGuests: false });
  expect(repeated.body.room.players).toHaveLength(1);
  expect((await request("/", body)).status).toBe(403);
  expect((await app.locals.matches.load("RETRY123")).players).toHaveLength(1);
});


test("lobby guest leaves without closing the room; host closes it with one read and one write", async () => {
  const a = await request("/", { code: "TESTROOM", mode: "classic", name: "Host", allowGuests: true });
  const b = await request("/TESTROOM/join", { name: "Guest" });
  expect((await request("/TESTROOM/leave", { playerId: b.body.room.selfId })).status).toBe(403);
  let reads = 0, transactions = 0;
  const find = db.match.findUnique, transaction = db.$transaction;
  db.match.findUnique = (...args) => { reads++; return find(...args); };
  db.$transaction = (...args) => { transactions++; return transaction(...args); };
  const left = await request("/TESTROOM/leave", {}, b.cookie);
  expect(left.status).toBe(200);
  expect(left.body.room).toMatchObject({ status: "waiting", selfId: null });
  expect(left.body.room.players.map((p) => p.id)).toEqual([a.body.room.selfId]);
  expect(reads).toBe(1);
  expect(transactions).toBe(1);
  reads = transactions = 0;
  const closed = await request("/TESTROOM/leave", {}, a.cookie);
  expect(closed.status).toBe(200);
  expect(closed.body.room.status).toBe("finished");
  expect(reads).toBe(1);
  expect(transactions).toBe(0);
  expect((await app.locals.matches.load("TESTROOM")).status).toBe("FINISHED");
  expect((await request("/TESTROOM/join", { name: "Late guest" })).status).toBe(409);
  expect((await request("/TESTROOM/leave", {}, a.cookie)).status).toBe(200);
});

test("failed lobby deletion rolls back version and membership without broadcasting", async () => {
  await request("/", { code: "TESTROOM", mode: "classic", name: "Host", allowGuests: true });
  const b = await request("/TESTROOM/join", { name: "Guest" });
  const service = app.locals.matches;
  const before = await service.load("TESTROOM");
  const who = await service.identity({ headers: { cookie: b.cookie } });
  let broadcasts = 0;
  service.events.on("changed", () => broadcasts++);
  db.matchPlayer.delete = async () => { throw new Error("Delete failed"); };
  await expect(service.leave("TESTROOM", who)).rejects.toThrow("Delete failed");
  expect(await service.load("TESTROOM")).toEqual(before);
  expect(broadcasts).toBe(0);
});

test("a concurrent start prevents a stale lobby leave from deleting a match participant", async () => {
  const a = await request("/", { code: "TESTROOM", mode: "classic", name: "Host", allowGuests: true });
  const b = await request("/TESTROOM/join", { name: "Guest" });
  const service = app.locals.matches;
  const who = await service.identity({ headers: { cookie: b.cookie } });
  const originalTransaction = db.$transaction;
  db.$transaction = async (...args) => {
    db.$transaction = originalTransaction;
    expect((await request("/TESTROOM/start", {}, a.cookie)).status).toBe(200);
    return originalTransaction(...args);
  };
  await expect(service.leave("TESTROOM", who)).rejects.toThrow("Istaba mainījās");
  const after = await service.load("TESTROOM");
  expect(after.status).toBe("ACTIVE");
  expect(after.players).toHaveLength(2);
  expect(after.players.map((p) => p.result)).toEqual([null, null]);
  // Retry uses the current state and records resignation instead of deletion.
  expect((await service.leave("TESTROOM", who)).status).toBe("FINISHED");
  expect((await service.load("TESTROOM")).players.map((p) => p.result)).toEqual(["WIN", "DURAK"]);
});


test("background leave retries cannot remove a player who rejoined with a new membership", async () => {
  await request("/", { code: "TESTROOM", mode: "classic", name: "Host", allowGuests: true });
  const b = await request("/TESTROOM/join", { name: "Guest" });
  const intent = { membershipId: b.body.room.selfId };
  expect((await request("/TESTROOM/leave", intent, b.cookie)).status).toBe(200);
  const repeated = await request("/TESTROOM/leave", intent, b.cookie);
  expect(repeated.status).toBe(403);
  expect(repeated.body.code).toBe("NOT_ROOM_MEMBER");
  const joined = await request("/TESTROOM/join", { name: "Guest again" }, b.cookie);
  expect(joined.body.room.selfId).not.toBe(intent.membershipId);
  const delayed = await request("/TESTROOM/leave", intent, b.cookie);
  expect(delayed.body.code).toBe("NOT_ROOM_MEMBER");
  const current = (await request("/TESTROOM", undefined, b.cookie, "GET")).body.room;
  expect(current.selfId).toBe(joined.body.room.selfId);
  expect(current.players).toHaveLength(2);
});

test("repeated background resignation does not apply another loss or advance the game", async () => {
  const [a] = await setupMany(3);
  const intent = { membershipId: a.body.room.selfId };
  const left = await request("/TESTROOM/leave", intent, a.cookie);
  expect(left.status).toBe(200);
  const before = await app.locals.matches.load("TESTROOM");
  expect((await request("/TESTROOM/leave", intent, a.cookie)).status).toBe(200);
  expect(await app.locals.matches.load("TESTROOM")).toEqual(before);
});


async function finishedRound(count = 3) {
  const members = await setupMany(count);
  const room = await app.locals.matches.load("TESTROOM");
  const game = structuredClone(room.gameState);
  const ids = game.players.map((p) => p.id);
  game.phase = "finished";
  game.result = { loser: ids.at(-1), losers: [ids.at(-1)], winners: ids.slice(0, -1), reason: "cards" };
  await db.match.update({ where: { id: room.id }, data: {
    gameState: game, status: "FINISHED", endedAt: new Date(), version: { increment: 1 },
  } });
  for (const p of room.players) {
    await db.matchPlayer.update({ where: { id: p.id }, data: { result: String(p.id) === ids.at(-1) ? "DURAK" : "WIN" } });
  }
  return members;
}
async function voteNext(socket) {
  const current = await join(socket);
  const result = await socket.timeout(3000).emitWithAck("game:ready-next", {
    code: "TESTROOM", version: current.game.version,
  });
  expect(result.error).toBeUndefined();
  return result.game;
}

test.each([0, 2])("two ready players return to a shared lobby when player %i declines", async (leaverIndex) => {
  const members = await finishedRound();
  const leaver = members[leaverIndex];
  const staying = members.filter((_, i) => i !== leaverIndex);
  const sockets = await Promise.all(staying.map((m) => connect(m.cookie)));
  await voteNext(sockets[0]);
  expect((await voteNext(sockets[1])).nextRound).toMatchObject({ readyCount: 2, required: 3 });
  const before = await app.locals.matches.load("TESTROOM");
  const broadcast = new Promise((resolve) => {
    const returned = (game) => {
      if (!game.nextRound?.lobbyCode) return;
      sockets[0].off("game:state", returned);
      resolve(game);
    };
    sockets[0].on("game:state", returned);
  });
  const intent = { membershipId: leaver.body.room.selfId };
  expect((await request("/TESTROOM/leave", intent, leaver.cookie)).status).toBe(200);
  const game = await broadcast;
  expect(game.result).toEqual(before.gameState.result);
  const code = game.nextRound.lobbyCode;
  expect((await join(sockets[1])).game.nextRound.lobbyCode).toBe(code);
  const lobby = await app.locals.matches.load(code);
  expect(lobby.status).toBe("WAITING");
  expect(lobby.gameState).toBeNull();
  expect(lobby.players.map((p) => p.guestName)).toEqual(staying.map((m) => m.body.room.players.at(-1).name));
  expect(lobby).toMatchObject({ mode: before.mode, timeLimitSeconds: before.timeLimitSeconds, allowGuests: before.allowGuests });
  const saved = await app.locals.matches.load("TESTROOM");
  expect(saved.status).toBe("FINISHED");
  expect(saved.players.map((p) => p.result)).toEqual(before.players.map((p) => p.result));
  expect((await request("/TESTROOM/leave", intent, leaver.cookie)).status).toBe(200);
  expect(await app.locals.matches.load("TESTROOM")).toEqual(saved);
  for (const m of staying) {
    const restored = await request(`/${code}/join`, { name: "Ignored" }, m.cookie);
    expect(restored.body.room.selfId).toBeTruthy();
    expect(restored.body.room.players).toHaveLength(2);
  }
  // The oldest remaining participant becomes the new host and can start manually.
  expect((await request(`/${code}/start`, {}, staying[0].cookie)).body.room.status).toBe("active");
});

test("a decline before voting sends remaining players to the lobby and prevents another rematch", async () => {
  const [a, b, c] = await finishedRound();
  await request("/TESTROOM/leave", { membershipId: c.body.room.selfId }, c.cookie);
  const sa = await connect(a.cookie), sb = await connect(b.cookie), sc = await connect(c.cookie);
  const code = (await join(sa)).game.nextRound.lobbyCode;
  expect(code).toBeTruthy();
  expect((await join(sb)).game.nextRound.lobbyCode).toBe(code);
  const departed = (await join(sc)).game;
  expect(departed.nextRound.lobbyCode).toBeNull();
  expect(departed.nextRound.canVote).toBe(false);
  expect((await sc.timeout(3000).emitWithAck("game:ready-next", { code: "TESTROOM", version: departed.version })).status).toBe(403);
  expect((await voteNext(sa)).nextRound.lobbyCode).toBe(code);
  expect((await app.locals.matches.load(code)).players).toHaveLength(2);
});

test("one remaining player returns to a lobby instead of waiting for a rematch alone", async () => {
  const [a, b] = await finishedRound(2);
  const sa = await connect(a.cookie);
  await voteNext(sa);
  await request("/TESTROOM/leave", { membershipId: b.body.room.selfId }, b.cookie);
  const code = (await join(sa)).game.nextRound.lobbyCode;
  expect((await app.locals.matches.load(code)).players).toHaveLength(1);
  const start = await request(`/${code}/start`, {}, a.cookie);
  expect(start.body.room).toMatchObject({ status: "active", multiplayer: false });
});

test("a second departure from the result screen also removes the transferred lobby membership", async () => {
  const [a, b, c] = await finishedRound();
  await request("/TESTROOM/leave", { membershipId: c.body.room.selfId }, c.cookie);
  const old = await app.locals.matches.load("TESTROOM");
  const code = old.gameState.nextRoundLobby.code;
  await request("/TESTROOM/leave", { membershipId: b.body.room.selfId }, b.cookie);
  expect((await app.locals.matches.load(code)).players).toHaveLength(1);
  const sa = await connect(a.cookie);
  expect((await join(sa)).game.nextRound.lobbyCode).toBe(code);
});

test("unanimous votes still start the next round directly", async () => {
  const members = await finishedRound();
  const sockets = await Promise.all(members.map((m) => connect(m.cookie)));
  await voteNext(sockets[0]);
  await voteNext(sockets[1]);
  expect((await voteNext(sockets[2])).result).toBeNull();
  expect((await app.locals.matches.load("TESTROOM")).status).toBe("ACTIVE");
});

test("failed lobby persistence rolls back departure and votes without broadcasting", async () => {
  const [a, b, c] = await finishedRound();
  await voteNext(await connect(a.cookie));
  await voteNext(await connect(b.cookie));
  const service = app.locals.matches;
  const before = await service.load("TESTROOM");
  const who = await service.identity({ headers: { cookie: c.cookie } });
  let broadcasts = 0;
  service.events.on("changed", () => broadcasts++);
  db.match.create = async () => { throw new Error("Lobby creation failed"); };
  await expect(service.leave("TESTROOM", who)).rejects.toThrow("Lobby creation failed");
  expect(await service.load("TESTROOM")).toEqual(before);
  expect(broadcasts).toBe(0);
});


test.each(["connected", "disconnected", "restarted"])("a full table waits for both confirmations with clients %s", async (connectionState) => {
  const members = await setupMany(3);
  const service = app.locals.matches;
  let room = await service.load("TESTROOM");
  const game = structuredClone(room.gameState);
  game.attacker = game.players[0].id;
  game.defender = game.players[1].id;
  game.attacks = [{ id: "pause-a", rank: 6, suit: "clubs" }, { id: "pause-b", rank: 6, suit: "hearts" }];
  game.defenses = [null, null];
  game.limit = 2;
  game.phase = "defend";
  game.updatedAt = Date.now();
  await db.match.update({ where: { id: room.id }, data: { gameState: game } });
  let pushed;
  if (connectionState === "connected") {
    const peer = await connect(members[0].cookie);
    await join(peer);
    pushed = new Promise((resolve) => {
      const listener = (state) => {
        if (state.bout !== 1) return;
        peer.off("game:state", listener);
        resolve(state);
      };
      peer.on("game:state", listener);
    });
  }
  const who = await service.identity({ headers: { cookie: members[1].cookie } });
  room = await service.action("TESTROOM", who, { type: "take", bout: 0 }, room.version);
  expect(room.gameState.settleAt).toBeNull();
  expect(room.gameState.attacks).toHaveLength(2);
  expect((await service.expireRoom("TESTROOM")).version).toBe(room.version);
  if (connectionState === "restarted") {
    rt.cleanup();
    await new Promise((resolve) => rt.io.close(resolve));
    server = createServer(app);
    rt = attachRealtime(server, service, { tickMs: 60000 });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect((await service.load("TESTROOM")).gameState.bout).toBe(0);
  const first = await service.identity({ headers: { cookie: members[0].cookie } });
  const second = await service.identity({ headers: { cookie: members[2].cookie } });
  room = await service.action("TESTROOM", first, { type: "finish", bout: 0 }, room.version);
  expect(room.gameState.bout).toBe(0);
  const settled = await service.action("TESTROOM", second, { type: "finish", bout: 0 }, room.version);
  expect(settled.gameState.bout).toBe(1);
  expect(settled.gameState.attacks).toEqual([]);
  if (pushed) expect((await pushed).attacks).toEqual([]);
});

test("both unlocked neighbours can submit concurrent throw-ins; stale approvals cannot finish a changed table", async () => {
  const members = await setupMany(3);
  const service = app.locals.matches;
  const identities = await Promise.all(members.map((m) => service.identity({ headers: { cookie: m.cookie } })));
  let room = await service.load("TESTROOM");
  const g = structuredClone(room.gameState);
  g.attacker = g.players[0].id;
  g.defender = g.players[1].id;
  g.players[0].hand = [{ id: "a", rank: 6, suit: "clubs" }, { id: "b", rank: 6, suit: "hearts" }];
  g.players[2].hand = [{ id: "c", rank: 6, suit: "diamonds" }];
  await db.match.update({ where: { id: room.id }, data: { gameState: g } });
  room = await service.action("TESTROOM", identities[0], { type: "attack", cardId: "a", bout: 0 }, room.version);
  room = await service.action("TESTROOM", identities[0], { type: "finish", bout: 0 }, room.version);
  const version = room.version;
  await Promise.all([
    service.action("TESTROOM", identities[0], { type: "attack", cardId: "b", bout: 0 }, version),
    service.action("TESTROOM", identities[2], { type: "attack", cardId: "c", bout: 0 }, version),
  ]);
  room = await service.load("TESTROOM");
  expect(room.gameState.attacks.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  expect(room.gameState.finishedAttackers).toEqual([]);
  await expect(service.action("TESTROOM", identities[0], { type: "finish", bout: 0 }, version)).rejects.toThrow();
});


test("completion archives once, retains the result on rematch, and archives the next round separately", async () => {
  const { a, b } = await setup();
  const service = app.locals.matches;
  const who = await service.identity({ headers: { cookie: a.cookie } });
  const other = await service.identity({ headers: { cookie: b.cookie } });
  let room = await service.load("TESTROOM");
  const initialVersion = room.version;
  const state = structuredClone(room.gameState);
  state.attacker = a.body.room.selfId; state.defender = b.body.room.selfId;
  state.players.find((p) => p.id === state.attacker).movesMade = 1;
  state.updatedAt = Date.now() - 700000;
  await db.match.update({ where: { id: room.id }, data: { gameState: state } });
  room = await service.expireRoom("TESTROOM");
  expect(db.history()).toHaveLength(1);
  const archived = db.history()[0];
  expect(archived.players.create.map((p) => p.result)).toEqual(["DURAK", "WIN"]);
  await expect(service.action("TESTROOM", who, { type: "resign" }, initialVersion)).rejects.toThrow();
  expect(db.history()).toHaveLength(1);
  room = await service.readyNextRound("TESTROOM", who, room.version);
  room = await service.readyNextRound("TESTROOM", other, room.version);
  expect(room.status).toBe("ACTIVE");
  expect(db.history()[0]).toEqual(archived);
  await service.action("TESTROOM", other, { type: "resign" }, room.version);
  expect(db.history()).toHaveLength(2);
  expect(db.history()[1].players.create.map((p) => p.result)).toEqual(["WIN", "DURAK"]);
});

test("history save failure rolls back completion and participant results", async () => {
  const { a } = await setup();
  const service = app.locals.matches;
  const room = await service.load("TESTROOM");
  const who = await service.identity({ headers: { cookie: a.cookie } });
  db.matchRound.upsert = async () => { throw new Error("History unavailable"); };
  await expect(service.action("TESTROOM", who, { type: "resign" }, room.version)).rejects.toThrow("History unavailable");
  expect(await service.load("TESTROOM")).toEqual(room);
  expect(db.history()).toHaveLength(0);
});
