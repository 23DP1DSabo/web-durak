import sharp from "sharp";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAuthApp } from "../app.js";

let server, base, db, users, sessions, friendships, matchPlayers, activeMatchPlayers, avatars;
beforeEach(async () => {
  avatars = new Map();
  users = []; sessions = new Map(); friendships = []; matchPlayers = []; activeMatchPlayers = [];
  db = {
    userAvatar: {
      upsert: async ({ where, create, update }) => {
        const row = avatars.has(where.userId) ? { ...avatars.get(where.userId), ...update } : create;
        avatars.set(where.userId, row);
        return row;
      },
      findUnique: async ({ where }) => avatars.get(where.userId) ?? null,
      deleteMany: async ({ where }) => ({ count: Number(avatars.delete(where.userId)) }),
    },
    user: {
      create: async ({ data }) => {
        if (users.some((u) => u.email === data.email || u.username === data.username)) throw { code: "P2002" };
        const user = { id: BigInt(users.length + 1), status: "ACTIVE", role: "USER", theme: "DARK", themeVersion: 0, avatar: null, ...data }; users.push(user); return user;
      },
      findUnique: async ({ where }) => users.find((u) =>
        where.id !== undefined ? u.id === where.id : u.email === where.email
      ),
      update: async ({ where, data }) => {
        const user = users.find((candidate) => candidate.id === where.id);
        if (!user) throw new Error("User not found");
        if (data.username && users.some((candidate) => candidate.id !== user.id && candidate.username === data.username)) {
          throw { code: "P2002" };
        }
        if (where.themeVersion !== undefined && user.themeVersion !== where.themeVersion) throw { code: "P2025" };
        for (const [key, value] of Object.entries(data)) {
          user[key] = value?.increment !== undefined ? user[key] + value.increment : value;
        }
        return user;
      },
      delete: async ({ where }) => {
        const index = users.findIndex((user) => user.id === where.id);
        if (index < 0) throw new Error("User not found");
        avatars.delete(where.id);
        return users.splice(index, 1)[0];
      },
      updateMany: async ({ where, data }) => {
        const matches = users.filter((user) =>
          user.status === where.status && user.banExpiresAt && user.banExpiresAt <= where.banExpiresAt.lte
        );
        for (const user of matches) Object.assign(user, data);
        return { count: matches.length };
      },
      findMany: async ({ orderBy, select }) => [...users]
        .sort((a, b) => orderBy.username === "asc"
          ? a.username.localeCompare(b.username)
          : b.username.localeCompare(a.username))
        .map((user) => ({
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          role: user.role,
          status: user.status,
          lastLoginAt: user.lastLoginAt,
          banExpiresAt: user.banExpiresAt ?? null,
          sessions: [...sessions.values()]
            .filter((session) => session.userId === user.id && session.expiresAt > select.sessions.where.expiresAt.gt)
            .map((session) => ({ tokenHash: session.tokenHash })),
        })),
    },
    session: {
      create: vi.fn(async ({ data }) => { sessions.set(data.tokenHash, data); return data; }),
      findUnique: async ({ where }) => {
        const s = sessions.get(where.tokenHash);
        return s ? { ...s, user: users.find((u) => u.id === s.userId) } : null;
      },
      deleteMany: async ({ where }) => {
        if (where.userId !== undefined) {
          let count = 0;
          for (const [tokenHash, session] of sessions) {
            if (session.userId === where.userId) {
              sessions.delete(tokenHash);
              count++;
            }
          }
          return { count };
        }
        return { count: Number(sessions.delete(where.tokenHash)) };
      },
    },
    friendship: {
      deleteMany: async ({ where }) => {
        const removed = friendships.filter((friendship) =>
          where.OR.some((condition) =>
            friendship.senderId === condition.senderId
            || friendship.recipientId === condition.recipientId
          )
        );
        friendships = friendships.filter((friendship) => !removed.includes(friendship));
        return { count: removed.length };
      },
    },
    matchPlayer: {
      findFirst: async ({ where }) => activeMatchPlayers.find(
        (player) => player.userId === where.userId
      ) ?? null,
      updateMany: async ({ where, data }) => {
        const matches = matchPlayers.filter((player) => player.userId === where.userId);
        for (const player of matches) Object.assign(player, data);
        return { count: matches.length };
      },
    },
    $transaction: async (callback) => {
      const oldAvatars = structuredClone(avatars);
      const oldUsers = structuredClone(users), oldSessions = structuredClone(sessions);
      const oldFriendships = structuredClone(friendships), oldMatchPlayers = structuredClone(matchPlayers);
      try { return await callback(db); }
      catch (error) {
        avatars = oldAvatars;
        users = oldUsers; sessions = oldSessions;
        friendships = oldFriendships; matchPlayers = oldMatchPlayers;
        throw error;
      }
    },
  };
  server = createAuthApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});
const credentials = { email: "player@example.com", password: "a strong password", name: "Player", username: "player" };
function post(route, body = credentials, cookie, extraHeaders = {}) {
  return fetch(`${base}/api/auth/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
}
const cookieOf = (response) => response.headers.get("set-cookie").split(";")[0];
const me = (cookie) => fetch(`${base}/api/auth/me`, { headers: cookie ? { cookie } : {} });

test("register, restore session, rotate on login, logout and reject revoked session", async () => {
  const registered = await post("register", { ...credentials, email: " Player@Example.com " });
  expect(registered.status).toBe(201);
  expect(await registered.json()).toEqual({ user: { id: "1", email: credentials.email, name: "Player", username: "player", avatar: null, theme: "DARK", themeVersion: 0, role: "USER" } });
  expect(users[0].passwordHash).not.toContain(credentials.password);
  expect(users[0].lastLoginAt).toBeInstanceOf(Date);
  const first = cookieOf(registered);
  expect(registered.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
  expect(sessions.has(first.split("=")[1])).toBe(false);
  expect((await me(first)).status).toBe(200);
  const loggedIn = await post("login", credentials, first);
  expect(loggedIn.status).toBe(200);
  expect(users[0].lastLoginAt).toBeInstanceOf(Date);
  const second = cookieOf(loggedIn);
  expect(second).not.toBe(first);
  expect((await me(first)).status).toBe(401);
  expect((await me(second)).status).toBe(200);
  expect((await post("logout", {}, second)).status).toBe(204);
  expect((await me(second)).status).toBe(401);
  expect((await post("logout", {}, second)).status).toBe(204);
});
test("reject duplicate registration, invalid input and incorrect credentials", async () => {
  expect((await post("register")).status).toBe(201);
  expect((await post("register")).status).toBe(409);
  for (const body of [{}, { ...credentials, password: "short" }, { ...credentials, name: {} }, { ...credentials, email: "bad" }, { ...credentials, password: "x".repeat(129) }]) {
    expect((await post("register", body)).status).toBe(400);
  }
  expect((await post("login", { ...credentials, password: "incorrect" })).status).toBe(401);
  expect((await post("login", { ...credentials, email: "missing@example.com" })).status).toBe(401);
  expect(sessions.size).toBe(1);
});
test("expired, malformed and missing sessions are rejected without caching", async () => {
  const cookie = cookieOf(await post("register"));
  for (const session of sessions.values()) session.expiresAt = new Date(0);
  for (const token of [cookie, "durak_session=invalid", undefined]) {
    const response = await me(token);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  }
  expect(sessions.size).toBe(0);
});
test("registration rolls back when session storage fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.session.create.mockRejectedValueOnce(new Error("database unavailable"));
  const response = await post("register");
  expect(response.status).toBe(500);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(users).toHaveLength(0);
});
test("blocks cross-origin requests and accepts configured origin", async () => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000, http://192.168.1.105:3000");
  expect((await post("register", credentials, null, { origin: "https://other.example" })).status).toBe(403);
  expect((await post("register", credentials, null, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await fetch(`${base}/api/auth/theme`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", origin: "https://other.example" },
    body: JSON.stringify({ theme: "LIGHT" }),
  })).status).toBe(403);
  expect((await post("register", credentials, null, { origin: "http://localhost:3000" })).status).toBe(201);
  expect((await post("register", {
    ...credentials,
    email: "lan-player@example.com",
    username: "lanplayer",
  }, null, { origin: "http://192.168.1.105:3000" })).status).toBe(201);
});
test("limits repeated attempts and returns JSON for malformed requests", async () => {
  const invalid = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toHaveProperty("error");
  for (let i = 0; i < 30; i++) expect((await post("login", {})).status).toBe(400);
  const limited = await post("login", {});
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
});
test("production sessions use secure cookies", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await post("register")).headers.get("set-cookie")).toContain("; Secure");
});

test("username is required and unique, and registration cannot grant administrator access", async () => {
  expect((await post("register", { ...credentials, username: "" })).status).toBe(400);
  expect((await post("register", { ...credentials, username: "x".repeat(51) })).status).toBe(400);
  expect((await post("register", { ...credentials, name: "" })).status).toBe(400);
  expect((await post("register", { ...credentials, name: "x".repeat(51) })).status).toBe(400);
  const created = await post("register", { ...credentials, role: "ADMIN", status: "BANNED" });
  expect(created.status).toBe(201);
  expect((await created.json()).user.role).toBe("USER");
  expect(users[0].status).toBe("ACTIVE");
  expect((await post("register", { ...credentials, email: "another@example.com" })).status).toBe(409);
});

test("banned accounts cannot sign in or reuse an existing session", async () => {
  const cookie = cookieOf(await post("register"));
  users[0].status = "BANNED";
  const response = await post("login");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Šis konts ir bloķēts.",
    banExpiresAt: null,
  });
  expect((await me(cookie)).status).toBe(401);
  expect(sessions.size).toBe(0);
});

test("admin users endpoint is protected and returns presence and last login without secrets", async () => {
  const regularCookie = cookieOf(await post("register", {
    ...credentials,
    email: "regular@example.com",
    username: "regular",
  }));
  const anonymousResponse = await fetch(`${base}/api/admin/users`);
  expect(anonymousResponse.status).toBe(401);

  const regularResponse = await fetch(`${base}/api/admin/users`, {
    headers: { cookie: regularCookie },
  });
  expect(regularResponse.status).toBe(403);

  const adminCookie = cookieOf(await post("register", {
    ...credentials,
    email: "admin@example.com",
    username: "admin",
  }));
  users.find((user) => user.username === "admin").role = "ADMIN";
  users.find((user) => user.username === "admin").avatar = "https://example.test/avatar.png";
  const expiredSession = [...sessions.entries()].find(([, session]) => session.userId === 1n);
  expiredSession[1].expiresAt = new Date(0);

  const response = await fetch(`${base}/api/admin/users`, {
    headers: { cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.users).toEqual([
    {
      id: "2",
      username: "admin",
      avatar: "https://example.test/avatar.png",
      role: "ADMIN",
      status: "ACTIVE",
      lastLoginAt: expect.any(String),
      banExpiresAt: null,
      isOnline: true,
      isSelf: true,
    },
    {
      id: "1",
      username: "regular",
      avatar: null,
      role: "USER",
      status: "ACTIVE",
      lastLoginAt: expect.any(String),
      banExpiresAt: null,
      isOnline: false,
      isSelf: false,
    },
  ]);
  expect(JSON.stringify(body)).not.toContain("passwordHash");
  expect(JSON.stringify(body)).not.toContain("tokenHash");
  expect(JSON.stringify(body)).not.toContain("epasts");
});

test("online status follows recent activity, not merely an unexpired session", async () => {
  const adminCookie = cookieOf(await post("register", { ...credentials, username: "admin" }));
  users[0].role = "ADMIN";
  const playerCookie = cookieOf(await post("register", {
    ...credentials, email: "idle@example.com", username: "idle",
  }));
  // A valid session from before a restart, or an idle week-old login.
  sessions.set("a".repeat(64), { tokenHash: "a".repeat(64), userId: 2n, expiresAt: new Date(Date.now() + 60000) });
  const online = async () => {
    const response = await fetch(`${base}/api/admin/users`, { headers: { cookie: adminCookie } });
    return (await response.json()).users.find((user) => user.username === "idle").isOnline;
  };
  expect(await online()).toBe(true);
  expect((await post("logout", {}, playerCookie)).status).toBe(204);
  expect(await online()).toBe(false);
});

test("admin can apply temporary and permanent bans, revoke sessions, and unban users", async () => {
  const adminCookie = cookieOf(await post("register", {
    ...credentials,
    email: "admin@example.com",
    username: "admin",
  }));
  users[0].role = "ADMIN";
  const userCookie = cookieOf(await post("register", {
    ...credentials,
    email: "target@example.com",
    username: "target",
  }));
  const endpoint = (userId, action, body) => fetch(
    `${base}/api/admin/users/${userId}/${action}`,
    {
      method: "POST",
      headers: {
        cookie: adminCookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );

  const temporary = await endpoint("2", "ban", { duration: "10m" });
  expect(temporary.status).toBe(200);
  expect(users[1].status).toBe("BANNED");
  expect(users[1].banExpiresAt.getTime()).toBeGreaterThan(Date.now());
  expect([...sessions.values()].some((session) => session.userId === 2n)).toBe(false);
  const loginResponse = await post("login", { ...credentials, email: "target@example.com" });
  expect(loginResponse.status).toBe(403);
  expect(await loginResponse.json()).toEqual({
    error: "Šis konts ir bloķēts.",
    banExpiresAt: users[1].banExpiresAt.toISOString(),
  });
  expect((await me(userCookie)).status).toBe(401);

  const permanent = await endpoint("2", "ban", { duration: "permanent" });
  expect(permanent.status).toBe(200);
  expect(users[1].status).toBe("BANNED");
  expect(users[1].banExpiresAt).toBeNull();
  const permanentlyBannedLogin = await post("login", {
    ...credentials,
    email: "target@example.com",
  });
  expect(permanentlyBannedLogin.status).toBe(403);
  expect(await permanentlyBannedLogin.json()).toEqual({
    error: "Šis konts ir bloķēts.",
    banExpiresAt: null,
  });

  expect((await endpoint("2", "unban")).status).toBe(200);
  expect(users[1].status).toBe("ACTIVE");
  expect(users[1].banExpiresAt).toBeNull();
  expect((await post("login", { ...credentials, email: "target@example.com" })).status).toBe(200);
});

test("ban routes reject invalid durations, ordinary users, self-bans, and administrator targets", async () => {
  const regularCookie = cookieOf(await post("register", {
    ...credentials,
    email: "regular@example.com",
    username: "regular",
  }));
  const regularBan = await fetch(`${base}/api/admin/users/1/ban`, {
    method: "POST",
    headers: { cookie: regularCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ duration: "10m" }),
  });
  expect(regularBan.status).toBe(403);

  const adminCookie = cookieOf(await post("register", {
    ...credentials,
    email: "admin@example.com",
    username: "admin",
  }));
  users[1].role = "ADMIN";
  await post("register", {
    ...credentials,
    email: "another-admin@example.com",
    username: "anotheradmin",
  });
  users[2].role = "ADMIN";
  const ban = (userId, duration) => fetch(`${base}/api/admin/users/${userId}/ban`, {
    method: "POST",
    headers: { cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ duration }),
  });
  expect((await ban("2", "10m")).status).toBe(400);
  expect((await ban("3", "10m")).status).toBe(400);
  expect((await ban("1", "unknown")).status).toBe(400);
  expect((await ban("not-an-id", "10m")).status).toBe(400);
  expect(users.every((user) => user.status === "ACTIVE")).toBe(true);
});

async function adminWithTarget() {
  const adminCookie = cookieOf(await post("register", { ...credentials, username: "admin" }));
  users[0].role = "ADMIN";
  const targetCookie = cookieOf(await post("register", {
    ...credentials, email: "target@example.com", username: "target",
  }));
  const admin = (path, method, body) => fetch(`${base}/api/admin/users/${path}`, {
    method,
    headers: { cookie: adminCookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { admin, targetCookie };
}

test("admin can grant and revoke administrator rights, but never their own", async () => {
  const { admin, targetCookie } = await adminWithTarget();

  const granted = await admin("2/role", "POST", { role: "ADMIN" });
  expect(granted.status).toBe(200);
  expect(await granted.json()).toEqual({ user: { id: "2", role: "ADMIN" } });
  expect((await fetch(`${base}/api/admin/users`, { headers: { cookie: targetCookie } })).status).toBe(200);

  expect((await admin("2/role", "POST", { role: "USER" })).status).toBe(200);
  expect(users[1].role).toBe("USER");
  expect((await fetch(`${base}/api/admin/users`, { headers: { cookie: targetCookie } })).status).toBe(403);

  expect((await admin("1/role", "POST", { role: "USER" })).status).toBe(400);
  expect((await admin("2/role", "POST", { role: "OWNER" })).status).toBe(400);
  expect((await admin("99/role", "POST", { role: "ADMIN" })).status).toBe(404);
  users[1].status = "BANNED";
  expect((await admin("2/role", "POST", { role: "ADMIN" })).status).toBe(400);
  expect(users.map((user) => user.role)).toEqual(["ADMIN", "USER"]);

  const regular = await fetch(`${base}/api/admin/users/1/role`, {
    method: "POST",
    headers: { cookie: targetCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "USER" }),
  });
  expect(regular.status).toBe(401); // The banned user's session no longer works.
});

test("admin account deletion needs the exact username and spares admins and players in games", async () => {
  const { admin, targetCookie } = await adminWithTarget();
  friendships = [{ senderId: 1n, recipientId: 2n }];
  matchPlayers = [{ userId: 2n, guestName: null, result: "WIN" }];

  expect((await admin("2", "DELETE", { confirmUsername: "Target" })).status).toBe(400);
  expect((await admin("1", "DELETE", { confirmUsername: "admin" })).status).toBe(400);
  users[1].role = "ADMIN";
  expect((await admin("2", "DELETE", { confirmUsername: "target" })).status).toBe(400);
  users[1].role = "USER";
  activeMatchPlayers = [{ userId: 2n }];
  expect((await admin("2", "DELETE", { confirmUsername: "target" })).status).toBe(409);
  expect(users).toHaveLength(2);

  activeMatchPlayers = [];
  expect((await admin("2", "DELETE", { confirmUsername: "target" })).status).toBe(204);
  expect(users.map((user) => user.username)).toEqual(["admin"]);
  expect(friendships).toEqual([]);
  expect(matchPlayers).toEqual([{ userId: null, guestName: "Dzēsts lietotājs", result: "WIN" }]);
  expect((await me(targetCookie)).status).toBe(401);
  expect((await admin("2", "DELETE", { confirmUsername: "target" })).status).toBe(404);
});

test("expired temporary ban is cleared and permits a fresh login", async () => {
  await post("register");
  users[0].status = "BANNED";
  users[0].banExpiresAt = new Date(Date.now() - 1000);

  const response = await post("login");
  expect(response.status).toBe(200);
  expect(users[0].status).toBe("ACTIVE");
  expect(users[0].banExpiresAt).toBeNull();
});

test("account settings require authentication and update username and theme", async () => {
  expect((await fetch(`${base}/api/auth/username`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "updated" }),
  })).status).toBe(401);

  const cookie = cookieOf(await post("register"));
  await post("register", { ...credentials, email: "other@example.com", username: "taken" });
  const renamed = await fetch(`${base}/api/auth/username`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ username: "updated_1" }),
  });
  expect(renamed.status).toBe(200);
  expect((await renamed.json()).user.username).toBe("updated_1");

  expect((await fetch(`${base}/api/auth/username`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ username: "taken" }),
  })).status).toBe(409);
  expect((await fetch(`${base}/api/auth/username`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ username: "not valid" }),
  })).status).toBe(400);

  const themed = await fetch(`${base}/api/auth/theme`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ theme: "LIGHT" }),
  });
  expect(themed.status).toBe(200);
  expect((await themed.json()).user.theme).toBe("LIGHT");
  const modern = await fetch(`${base}/api/auth/theme`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ theme: "MODERN", expectedVersion: 1 }),
  });
  expect(modern.status).toBe(200);
  expect((await modern.json()).user.theme).toBe("MODERN");
  expect((await (await me(cookie)).json()).user.theme).toBe("MODERN");
  expect((await fetch(`${base}/api/auth/theme`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ theme: "UNKNOWN" }),
  })).status).toBe(400);
});

test("password change verifies the current password and accepts only a valid new one", async () => {
  const cookie = cookieOf(await post("register"));
  const change = (currentPassword, newPassword) => fetch(`${base}/api/auth/password`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  expect((await change("incorrect password", "another strong password")).status).toBe(400);
  expect((await change(credentials.password, "short")).status).toBe(400);
  expect((await change(credentials.password, "another strong password")).status).toBe(200);
  expect((await post("login", credentials)).status).toBe(401);
  expect((await post("login", { ...credentials, password: "another strong password" })).status).toBe(200);
});

test("account deletion verifies password, blocks active games, and anonymizes match history", async () => {
  const unauthenticated = await fetch(`${base}/api/auth/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: credentials.password }),
  });
  expect(unauthenticated.status).toBe(401);

  const cookie = cookieOf(await post("register"));
  const remove = (currentPassword) => fetch(`${base}/api/auth/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ currentPassword }),
  });

  expect((await remove("incorrect password")).status).toBe(400);
  friendships = [
    { senderId: 1n, recipientId: 2n },
    { senderId: 3n, recipientId: 1n },
    { senderId: 2n, recipientId: 3n },
  ];
  matchPlayers = [
    { userId: 1n, guestName: null, result: "WIN" },
    { userId: 2n, guestName: null, result: "DURAK" },
  ];
  activeMatchPlayers = [{ userId: 1n }];

  const active = await remove(credentials.password);
  expect(active.status).toBe(409);
  expect(users).toHaveLength(1);
  expect(sessions.size).toBe(1);
  expect(friendships).toHaveLength(3);
  expect(matchPlayers[0].userId).toBe(1n);

  activeMatchPlayers = [];
  const deleted = await remove(credentials.password);
  expect(deleted.status).toBe(204);
  expect(deleted.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(users).toHaveLength(0);
  expect(sessions.size).toBe(0);
  expect(friendships).toEqual([{ senderId: 2n, recipientId: 3n }]);
  expect(matchPlayers).toEqual([
    { userId: null, guestName: "Dzēsts lietotājs", result: "WIN" },
    { userId: 2n, guestName: null, result: "DURAK" },
  ]);
  expect((await me(cookie)).status).toBe(401);
});

const avatarImage = (background = "red", width = 40, height = 60) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
function uploadAvatar(cookie, body, type = "image/png", extraHeaders = {}) {
  return fetch(`${base}/api/auth/avatar`, {
    method: "PUT", headers: { "Content-Type": type, ...(cookie ? { cookie } : {}), ...extraHeaders }, body,
  });
}
const removeAvatar = (cookie) => fetch(`${base}/api/auth/avatar`, {
  method: "DELETE", headers: cookie ? { cookie } : {},
});
test("profile image is normalized, persists in the session, can be replaced and removed", async () => {
  const cookie = cookieOf(await post("register"));
  const uploaded = await uploadAvatar(cookie, await avatarImage());
  expect(uploaded.status).toBe(200);
  const { user } = await uploaded.json();
  expect(user.avatar).toMatch(/^\/api\/avatars\/1\?v=[a-f0-9]{64}$/);
  expect((await (await me(cookie)).json()).user.avatar).toBe(user.avatar);
  const response = await fetch(base + user.avatar);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  expect(metadata).toMatchObject({ width: 512, height: 512, format: "webp" });
  expect(metadata.exif).toBeUndefined();
  const replaced = await (await uploadAvatar(cookie, await avatarImage("blue"))).json();
  expect(replaced.user.avatar).not.toBe(user.avatar);
  expect((await fetch(base + user.avatar)).status).toBe(404);
  expect((await fetch(base + replaced.user.avatar)).status).toBe(200);
  expect((await (await removeAvatar(cookie)).json()).user.avatar).toBeNull();
  expect(avatars.size).toBe(0);
  expect((await fetch(base + replaced.user.avatar)).status).toBe(404);
  expect((await removeAvatar(cookie)).status).toBe(200);
});
test("profile upload rejects forged, oversized and corrupt images without changing the saved picture", async () => {
  const cookie = cookieOf(await post("register"));
  await uploadAvatar(cookie, await avatarImage());
  const original = users[0].avatar;
  for (const [body, type] of [
    [Buffer.from("not an image"), "image/png"],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>'), "image/png"],
    [await avatarImage(), "text/plain"],
    [Buffer.alloc(0), "image/png"],
    [await avatarImage("red", 5000, 5000), "image/png"],
  ]) {
    expect((await uploadAvatar(cookie, body, type)).status).toBe(400);
    expect(users[0].avatar).toBe(original);
  }
  expect((await uploadAvatar(cookie, Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413);
  expect(users[0].avatar).toBe(original);
  for (const id of ["0", "-1", "bad", "9223372036854775808", "99999999999999999999999"]) {
    expect((await fetch(`${base}/api/avatars/${id}`)).status).toBe(404);
  }
});
test("avatar changes require an active session and allowed origin and affect only the authenticated user", async () => {
  const image = await avatarImage();
  expect((await uploadAvatar(null, image)).status).toBe(401);
  expect((await removeAvatar()).status).toBe(401);
  const first = cookieOf(await post("register"));
  await uploadAvatar(first, image);
  const original = users[0].avatar;
  const second = cookieOf(await post("register", { ...credentials, email: "other@example.com", username: "other" }));
  await uploadAvatar(second, await avatarImage("blue"));
  await removeAvatar(second);
  expect(users[0].avatar).toBe(original);
  expect(avatars.has(1n)).toBe(true);
  expect((await uploadAvatar(first, image, "image/png", { origin: "https://untrusted.example" })).status).toBe(403);
  users[0].status = "BANNED";
  expect((await uploadAvatar(first, image)).status).toBe(401);
  expect((await removeAvatar(first)).status).toBe(401);
  expect(users[0].avatar).toBe(original);
});
test("avatar updates roll back both image and URL if the database transaction fails", async () => {
  const cookie = cookieOf(await post("register"));
  await uploadAvatar(cookie, await avatarImage());
  const original = users[0].avatar;
  const digest = avatars.get(1n).digest;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(db.user, "update").mockRejectedValueOnce(new Error("write failed"));
  expect((await uploadAvatar(cookie, await avatarImage("blue"))).status).toBe(500);
  expect(users[0].avatar).toBe(original);
  expect(avatars.get(1n).digest).toBe(digest);
  vi.spyOn(db.user, "update").mockRejectedValueOnce(new Error("write failed"));
  expect((await removeAvatar(cookie)).status).toBe(500);
  expect(avatars.get(1n).digest).toBe(digest);
});
test("deleting an account removes its stored avatar", async () => {
  const cookie = cookieOf(await post("register"));
  const { user } = await (await uploadAvatar(cookie, await avatarImage())).json();
  const response = await fetch(`${base}/api/auth/account`, {
    method: "DELETE", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: credentials.password }),
  });
  expect(response.status).toBe(204);
  expect(avatars.size).toBe(0);
  expect((await fetch(base + user.avatar)).status).toBe(404);
});

test("JPEG and WebP uploads are accepted and animated images are rejected", async () => {
  const cookie = cookieOf(await post("register"));
  const png = await avatarImage();
  for (const format of ["jpeg", "webp"]) {
    const image = await sharp(png).toFormat(format).toBuffer();
    expect((await uploadAvatar(cookie, image, `image/${format}`)).status).toBe(200);
  }
  const frames = Buffer.concat([Buffer.alloc(20 * 20 * 3, 0), Buffer.alloc(20 * 20 * 3, 255)]);
  const animated = await sharp(frames, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  expect((await uploadAvatar(cookie, animated, "image/webp")).status).toBe(400);
});

test("a stale theme save cannot overwrite a newer choice, including returning to the original theme", async () => {
  const cookie = cookieOf(await post("register"));
  const change = (theme, expectedVersion) => fetch(`${base}/api/auth/theme`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ theme, expectedVersion }),
  });
  expect((await change("LIGHT", 0)).status).toBe(200);
  expect((await change("DARK", 1)).status).toBe(200);
  expect((await change("CLASSIC", 0)).status).toBe(409);
  expect((await change("LIGHT", 1)).status).toBe(409);
  const { user } = await (await me(cookie)).json();
  expect(user).toMatchObject({ theme: "DARK", themeVersion: 2 });
  expect((await change("CLASSIC", 2)).status).toBe(200);
  for (const invalid of [-1, 1.5, "2", null]) expect((await change("LIGHT", invalid)).status).toBe(400);
});
