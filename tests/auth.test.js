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
      findUnique: async ({ where }) => users.find((u) => u.email === where.email),
    },
    session: {
      create: vi.fn(async ({ data }) => { sessions.set(data.tokenHash, data); return data; }),
      findUnique: async ({ where }) => {
        const s = sessions.get(where.tokenHash);
        return s ? { ...s, user: users.find((u) => u.id === s.userId) } : null;
      },
      deleteMany: async ({ where }) => { sessions.delete(where.tokenHash); return { count: 1 }; },
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
  const first = cookieOf(registered);
  expect(registered.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
  expect(sessions.has(first.split("=")[1])).toBe(false);
  expect((await me(first)).status).toBe(200);
  const loggedIn = await post("login", credentials, first);
  expect(loggedIn.status).toBe(200);
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
