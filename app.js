import "dotenv/config";
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import express from "express";

import { createFriendsRouter } from "./router/friends.js";


export function createAuthApp(prisma) {
  const authApp = express();
  const sessionDuration = 7 * 24 * 60 * 60 * 1000;
  const scryptAsync = promisify(scrypt);

  authApp.disable("x-powered-by");
  authApp.use("/api/auth", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST" && (req.get("sec-fetch-site") === "cross-site"
      || (req.get("origin") && req.get("origin") !== (process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`)))) {
      return res.status(403).json({ error: "Pieprasījuma izcelsme nav atļauta." });
    }
    next();
  });
  authApp.use(express.json({ limit: "4kb" }));
  // Bounded, per-process limiter. Configure a shared limiter before scaling to multiple servers.
  const attempts = new Map();
  authApp.use(["/api/auth/login", "/api/auth/register"], (req, res, next) => {
    if (req.method !== "POST") return next();
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 30 || (!attempts.has(key) && attempts.size >= 10000)) {
      res.setHeader("Retry-After", Math.ceil((entry.until - now) / 1000));
      return res.status(429).json({ error: "Pārāk daudz mēģinājumu. Lūdzu, mēģiniet vēlāk." });
    }
    entry.count++;
    attempts.set(key, entry);
    next();
  });

  authApp.get("/api/health/db", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ database: "connected" });
    } catch (error) {
      console.error("Database health check failed:", error);
      res.status(500).json({ database: "disconnected" });
    }
  });

  function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
  }

  function setSessionCookie(res, token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `durak_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDuration / 1000}${secure}`,
    );
  }

  function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", "durak_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  }

  function getSessionToken(req) {
    const sessionCookie = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("durak_session="));
    const token = sessionCookie?.slice("durak_session=".length);
    return /^[a-f0-9]{64}$/.test(token || "") ? token : null;
  }

  function publicUser(user) {
    return { id: String(user.id), email: user.email, name: user.name,
      username: user.username, avatar: user.avatar, theme: user.theme, role: user.role };
  }

  async function createSession(db, userId, req) {
    const token = randomBytes(32).toString("hex");
    const previous = getSessionToken(req);
    if (previous) await db.session.deleteMany({ where: { tokenHash: hashToken(previous) } });

    await db.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + sessionDuration),
      },
    });

    return token;
  }

  async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = await scryptAsync(password, salt, 64);
    return `${salt}:${Buffer.from(hash).toString("hex")}`;
  }

  async function verifyPassword(password, storedHash) {
    if (typeof storedHash !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(storedHash)) return false;
    const [salt, savedHash] = storedHash.split(":");
    if (!salt || !savedHash) return false;

    const hash = await scryptAsync(password, salt, 64);
    const savedBuffer = Buffer.from(savedHash, "hex");
    return savedBuffer.length === hash.length && timingSafeEqual(savedBuffer, hash);
  }

  function validCredentials(email, password) {
    return typeof email === "string"
      && email.length <= 255
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      && typeof password === "string"
      && password.length >= 8
      && password.length <= 128;
  }

  authApp.post("/api/auth/register", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";

    if (!validCredentials(email, password) || !name || name.length > 50
      || !/^[\p{L}\p{N}_]{1,50}$/u.test(username)) {
      return res.status(400).json({ error: "Norādiet vārdu un lietotājvārdu līdz 50 rakstzīmēm, derīgu e-pastu un paroli no 8 līdz 128 rakstzīmēm. Lietotājvārdā atļauti burti, cipari un pasvītrojums." });
    }

    try {
      const passwordHash = await hashPassword(password);
      const { user, token } = await prisma.$transaction(async (db) => {
        const user = await db.user.create({ data: { email, name, username, passwordHash } });
        const token = await createSession(db, user.id, req);
        return { user, token };
      });
      setSessionCookie(res, token);
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error?.code === "P2002") {
        return res.status(409).json({ error: "Šis e-pasts vai lietotājvārds jau tiek izmantots." });
      }
      console.error("Registration failed:", error);
      return res.status(500).json({ error: "Neizdevās izveidot kontu." });
    }
  });

  authApp.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;

    if (!validCredentials(email, password)) {
      return res.status(400).json({ error: "Ievadiet derīgu e-pastu un paroli." });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
        return res.status(401).json({ error: "Nepareizs e-pasts vai parole." });
      }
      if (user.status === "BANNED") {
        return res.status(403).json({ error: "Šis konts ir bloķēts." });
      }

      const token = await prisma.$transaction((db) => createSession(db, user.id, req));
      setSessionCookie(res, token);
      return res.json({ user: publicUser(user) });
    } catch (error) {
      console.error("Login failed:", error);
      return res.status(500).json({ error: "Neizdevās pieslēgties." });
    }
  });

  authApp.get("/api/auth/me", async (req, res) => {
    const token = getSessionToken(req);

    if (!token) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Jūs neesat pieslēdzies." });
    }

    try {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      });

      if (!session || session.expiresAt <= new Date() || session.user.status === "BANNED") {
        if (session) {
          await prisma.session.deleteMany({
            where: { tokenHash: session.tokenHash },
          });
        }

        clearSessionCookie(res);
        return res.status(401).json({ error: "Jūs neesat pieslēdzies." });
      }

      return res.json({ user: publicUser(session.user) });
    } catch (error) {
      console.error("Session lookup failed:", error);
      return res.status(500).json({
        error: "Neizdevās pārbaudīt pieslēgšanās statusu.",
      });
    }
  });

  authApp.post("/api/auth/logout", async (req, res) => {
    const token = getSessionToken(req);

    try {
      if (token) {
        await prisma.session.deleteMany({
          where: { tokenHash: hashToken(token) },
        });
      }

      clearSessionCookie(res);
      return res.status(204).end();
    } catch (error) {
      console.error("Logout failed:", error);
      return res.status(500).json({ error: "Neizdevās izrakstīties." });
    }
  });

  authApp.use(
    "/api/friends",
    createFriendsRouter(prisma, {
      getSessionToken,
      clearSessionCookie,
    }),
  );


  authApp.use((error, req, res, next) => {
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Pieprasījums ir pārāk liels." });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Nederīgs JSON pieprasījums." });
    console.error("API error:", error);
    res.status(500).json({ error: "Servera kļūda. Mēģiniet vēlāk." });
  });
  return authApp;
}
