import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAuthApp } from "../app.js";

let server, base, db, users, sessions;
beforeEach(async () => {
  users = []; sessions = new Map();
  db = {
    user: {
      create: async ({ data }) => {
        if (users.some((u) => u.email === data.email || u.username === data.username)) throw { code: "P2002" };
        const user = { id: BigInt(users.length + 1), status: "ACTIVE", role: "USER", theme: "DARK", avatar: null, ...data }; users.push(user); return user;
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
        Object.assign(user, data);
        return user;
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
            .slice(0, select.sessions.take)
            .map(() => ({ tokenHash: "not-returned-to-client" })),
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
    $transaction: async (callback) => {
      const oldUsers = structuredClone(users), oldSessions = structuredClone(sessions);
      try { return await callback(db); }
      catch (error) { users = oldUsers; sessions = oldSessions; throw error; }
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
  expect(await registered.json()).toEqual({ user: { id: "1", email: credentials.email, name: "Player", username: "player", avatar: null, theme: "DARK", role: "USER" } });
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
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  expect((await post("register", credentials, null, { origin: "https://other.example" })).status).toBe(403);
  expect((await post("register", credentials, null, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await fetch(`${base}/api/auth/theme`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", origin: "https://other.example" },
    body: JSON.stringify({ theme: "LIGHT" }),
  })).status).toBe(403);
  expect((await post("register", credentials, null, { origin: "http://localhost:3000" })).status).toBe(201);
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
  expect((await post("login")).status).toBe(403);
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
    },
  ]);
  expect(JSON.stringify(body)).not.toContain("passwordHash");
  expect(JSON.stringify(body)).not.toContain("tokenHash");
  expect(JSON.stringify(body)).not.toContain("epasts");
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
  expect((await post("login", { ...credentials, email: "target@example.com" })).status).toBe(403);
  expect((await me(userCookie)).status).toBe(401);

  const permanent = await endpoint("2", "ban", { duration: "permanent" });
  expect(permanent.status).toBe(200);
  expect(users[1].status).toBe("BANNED");
  expect(users[1].banExpiresAt).toBeNull();

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
