import { createHistoryRouter } from "./router/history.js";
import "dotenv/config";
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { createAvatarRouter } from "./router/avatar.js";

import { createFriendsRouter } from "./router/friends.js";
import { GameError } from "./lib/multiplayer.js";
import { createMatchService } from "./lib/matches.js";
import { allowedOrigins, isAllowedOrigin } from "./lib/origins.js";
import { createInvites } from "./lib/invites.js";
import { createPresence } from "./lib/presence.js";
import { createRoomsRouter } from "./router/room.js";


export function createAuthApp(prisma) {
  const authApp = express();
  // Railway's edge proxy forwards every request, so without this req.ip is the
  // proxy and all visitors share one login rate limit.
  if (process.env.NODE_ENV === "production") authApp.set("trust proxy", 1);
  const presence = createPresence();
  const sessionDuration = 7 * 24 * 60 * 60 * 1000;
  const scryptAsync = promisify(scrypt);
  const banDurations = {
    "10s": 10 * 1000,
    "10m": 10 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "178d": 178 * 24 * 60 * 60 * 1000,
    "356d": 356 * 24 * 60 * 60 * 1000,
    "712d": 712 * 24 * 60 * 60 * 1000,
  };

  authApp.disable("x-powered-by");
  authApp.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origins = allowedOrigins(
      process.env.APP_ORIGIN,
      `${req.protocol}://${req.get("host")}`,
    );
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && (req.get("sec-fetch-site") === "cross-site"
      || !isAllowedOrigin(req.get("origin"), origins))) {
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

  async function getAuthenticatedUser(req, res) {
    const token = getSessionToken(req);
    if (!token) {
      clearSessionCookie(res);
      res.status(401).json({ error: "Jūs neesat pieslēdzies." });
      return null;
    }

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (session?.user.status === "BANNED" && session.user.banExpiresAt
      && session.user.banExpiresAt <= new Date()) {
      session.user = await prisma.user.update({
        where: { id: session.user.id },
        data: { status: "ACTIVE", banExpiresAt: null },
      });
    }
    if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
      if (session) {
        await prisma.session.deleteMany({ where: { tokenHash: session.tokenHash } });
      }
      clearSessionCookie(res);
      res.status(401).json({ error: "Jūs neesat pieslēdzies." });
      return null;
    }
    presence.touch(session.tokenHash);
    return session.user;
  }

  function publicUser(user) {
    return { id: String(user.id), email: user.email, name: user.name,
      username: user.username, avatar: user.avatar, theme: user.theme, themeVersion: user.themeVersion, role: user.role };
  }

  async function createSession(db, userId, req) {
    const token = randomBytes(32).toString("hex");
    const previous = getSessionToken(req);
    if (previous) await db.session.deleteMany({ where: { tokenHash: hashToken(previous) } });

    const tokenHash = hashToken(token);
    await db.session.create({
      data: {
        tokenHash,
        userId,
        expiresAt: new Date(Date.now() + sessionDuration),
      },
    });
    presence.touch(tokenHash);

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

  // Keeps match results, anonymized. Returns false while the user is still in a
  // waiting room or an active game.
  function deleteUserAccount(userId) {
    return prisma.$transaction(async (db) => {
      const activeMatch = await db.matchPlayer.findFirst({
        where: {
          userId,
          match: { is: { status: { in: ["WAITING", "ACTIVE"] } } },
        },
        select: { id: true },
      });
      if (activeMatch) return false;

      await db.friendship.deleteMany({
        where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      });
      await db.matchPlayer.updateMany({
        where: { userId },
        data: { userId: null, guestName: "Dzēsts lietotājs" },
      });
      await db.session.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
      return true;
    });
  }

  function parseUserId(value) {
    if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return null;
    const id = BigInt(value);
    return id <= 9223372036854775807n ? id : null;
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
        const user = await db.user.create({
          data: { email, name, username, passwordHash, lastLoginAt: new Date() },
        });
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
        if (!user.banExpiresAt || user.banExpiresAt > new Date()) {
          return res.status(403).json({
            error: "Šis konts ir bloķēts.",
            banExpiresAt: user.banExpiresAt ?? null,
          });
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "ACTIVE", banExpiresAt: null },
        });
      }

      const token = await prisma.$transaction(async (db) => {
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        return createSession(db, user.id, req);
      });
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

      if (session?.user.status === "BANNED" && session.user.banExpiresAt
        && session.user.banExpiresAt <= new Date()) {
        session.user = await prisma.user.update({
          where: { id: session.user.id },
          data: { status: "ACTIVE", banExpiresAt: null },
        });
      }

      if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
        if (session) {
          await prisma.session.deleteMany({
            where: { tokenHash: session.tokenHash },
          });
        }

        clearSessionCookie(res);
        return res.status(401).json({ error: "Jūs neesat pieslēdzies." });
      }

      presence.touch(session.tokenHash);
      return res.json({ user: publicUser(session.user) });
    } catch (error) {
      console.error("Session lookup failed:", error);
      return res.status(500).json({
        error: "Neizdevās pārbaudīt pieslēgšanās statusu.",
      });
    }
  });

  authApp.use("/api/me", createHistoryRouter(prisma, { getAuthenticatedUser }));

  authApp.use("/api", createAvatarRouter(prisma, { getAuthenticatedUser, publicUser }));

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

  authApp.delete("/api/auth/account", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req, res);
      if (!user) return;

      const currentPassword = req.body?.currentPassword;
      if (typeof currentPassword !== "string" || currentPassword.length > 128) {
        return res.status(400).json({ error: "Ievadiet pašreizējo paroli." });
      }
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        return res.status(400).json({ error: "Pašreizējā parole nav pareiza." });
      }

      if (!(await deleteUserAccount(user.id))) {
        return res.status(409).json({
          error: "Pirms konta dzēšanas izej no visām gaidošajām istabām un pabeidz aktīvās spēles.",
        });
      }

      clearSessionCookie(res);
      return res.status(204).end();
    } catch (error) {
      console.error("Account deletion failed:", error);
      return res.status(500).json({ error: "Neizdevās dzēst kontu." });
    }
  });

  authApp.patch("/api/auth/username", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req, res);
      if (!user) return;

      const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
      if (!/^[\p{L}\p{N}_]{1,50}$/u.test(username)) {
        return res.status(400).json({
          error: "Lietotājvārdā atļauti burti, cipari un pasvītrojums (līdz 50 rakstzīmēm).",
        });
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { username },
      });
      return res.json({ user: publicUser(updatedUser) });
    } catch (error) {
      if (error?.code === "P2002") {
        return res.status(409).json({ error: "Šis lietotājvārds jau tiek izmantots." });
      }
      console.error("Username update failed:", error);
      return res.status(500).json({ error: "Neizdevās nomainīt lietotājvārdu." });
    }
  });

  authApp.patch("/api/auth/password", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req, res);
      if (!user) return;

      const currentPassword = req.body?.currentPassword;
      const newPassword = req.body?.newPassword;
      if (typeof currentPassword !== "string" || currentPassword.length > 128
        || typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
        return res.status(400).json({
          error: "Norādiet pašreizējo paroli un jaunu paroli no 8 līdz 128 rakstzīmēm.",
        });
      }
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        return res.status(400).json({ error: "Pašreizējā parole nav pareiza." });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      return res.json({ message: "Parole veiksmīgi nomainīta." });
    } catch (error) {
      console.error("Password update failed:", error);
      return res.status(500).json({ error: "Neizdevās nomainīt paroli." });
    }
  });

  authApp.patch("/api/auth/theme", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req, res);
      if (!user) return;

      const theme = req.body?.theme;
      if (!["CLASSIC", "LIGHT", "DARK", "MODERN"].includes(theme)) {
        return res.status(400).json({ error: "Izvēlieties derīgu tēmu." });
      }

      const expectedVersion = req.body?.expectedVersion;
      if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
        return res.status(400).json({ error: "Nederīga tēmas versija." });
      }
      // A delayed request from the previous page cannot overwrite a newer choice.
      const updatedUser = await prisma.user.update({
        where: { id: user.id, ...(expectedVersion === undefined ? {} : { themeVersion: expectedVersion }) },
        data: { theme, themeVersion: { increment: 1 } },
      });
      return res.json({ user: publicUser(updatedUser) });
    } catch (error) {
      if (error?.code === "P2025") {
        return res.status(409).json({ error: "Tēma jau mainījusies. Atjauno konta datus un mēģini vēlreiz." });
      }
      console.error("Theme update failed:", error);
      return res.status(500).json({ error: "Neizdevās saglabāt tēmu." });
    }
  });

  async function getAdmin(req, res) {
    const user = await getAuthenticatedUser(req, res);
    if (user && user.role !== "ADMIN") {
      res.status(403).json({ error: "Šī darbība atļauta tikai administratoriem." });
      return null;
    }
    return user;
  }

  authApp.get("/api/admin/users", async (req, res) => {
    try {
      const user = await getAdmin(req, res);
      if (!user) return;

      res.setHeader("Cache-Control", "no-store");
      const now = new Date();
      await prisma.user.updateMany({
        where: { status: "BANNED", banExpiresAt: { lte: now } },
        data: { status: "ACTIVE", banExpiresAt: null },
      });
      const users = await prisma.user.findMany({
        orderBy: { username: "asc" },
        select: {
          id: true,
          username: true,
          avatar: true,
          role: true,
          status: true,
          lastLoginAt: true,
          banExpiresAt: true,
          sessions: {
            where: { expiresAt: { gt: now } },
            select: { tokenHash: true },
          },
        },
      });

      return res.json({
        users: users.map(({ sessions, ...listedUser }) => ({
          ...listedUser,
          id: String(listedUser.id),
          isOnline: listedUser.status === "ACTIVE"
            && sessions.some((session) => presence.isOnline(session.tokenHash)),
          isSelf: listedUser.id === user.id,
        })),
      });
    } catch (error) {
      console.error("Admin user list failed:", error);
      return res.status(500).json({ error: "Neizdevās ielādēt lietotāju sarakstu." });
    }
  });

  authApp.post("/api/admin/users/:userId/ban", async (req, res) => {
    try {
      const admin = await getAdmin(req, res);
      if (!admin) return;

      const targetId = parseUserId(req.params.userId);
      const duration = req.body?.duration;
      if (targetId === null || (duration !== "permanent" && !Object.hasOwn(banDurations, duration))) {
        return res.status(400).json({ error: "Norādiet derīgu lietotāju un bloķēšanas ilgumu." });
      }
      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "Lietotājs nav atrasts." });
      if (target.id === admin.id || target.role === "ADMIN") {
        return res.status(400).json({ error: "Administratora kontu bloķēt nevar." });
      }

      const banExpiresAt = duration === "permanent"
        ? null
        : new Date(Date.now() + banDurations[duration]);
      const updatedUser = await prisma.$transaction(async (db) => {
        const user = await db.user.update({
          where: { id: targetId },
          data: { status: "BANNED", banExpiresAt },
        });
        await db.session.deleteMany({ where: { userId: targetId } });
        return user;
      });
      return res.json({
        user: {
          id: String(updatedUser.id),
          status: updatedUser.status,
          banExpiresAt: updatedUser.banExpiresAt,
        },
      });
    } catch (error) {
      console.error("Admin user ban failed:", error);
      return res.status(500).json({ error: "Neizdevās bloķēt lietotāju." });
    }
  });

  authApp.post("/api/admin/users/:userId/unban", async (req, res) => {
    try {
      const admin = await getAdmin(req, res);
      if (!admin) return;

      const targetId = parseUserId(req.params.userId);
      if (targetId === null) {
        return res.status(400).json({ error: "Norādiet derīgu lietotāju." });
      }
      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "Lietotājs nav atrasts." });
      if (target.role === "ADMIN") {
        return res.status(400).json({ error: "Administratora konta statuss šeit nav maināms." });
      }

      const updatedUser = await prisma.user.update({
        where: { id: targetId },
        data: { status: "ACTIVE", banExpiresAt: null },
      });
      return res.json({
        user: { id: String(updatedUser.id), status: updatedUser.status, banExpiresAt: null },
      });
    } catch (error) {
      console.error("Admin user unban failed:", error);
      return res.status(500).json({ error: "Neizdevās atbloķēt lietotāju." });
    }
  });

  authApp.post("/api/admin/users/:userId/role", async (req, res) => {
    try {
      const admin = await getAdmin(req, res);
      if (!admin) return;

      const targetId = parseUserId(req.params.userId);
      const role = req.body?.role;
      if (targetId === null || !["USER", "ADMIN"].includes(role)) {
        return res.status(400).json({ error: "Norādiet derīgu lietotāju un lomu." });
      }
      // Admins cannot demote themselves, so at least one admin always remains.
      if (targetId === admin.id) {
        return res.status(400).json({ error: "Savas tiesības mainīt nevar." });
      }
      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "Lietotājs nav atrasts." });
      // Admin accounts cannot be unbanned, so a banned admin would stay locked out.
      if (role === "ADMIN" && target.status !== "ACTIVE") {
        return res.status(400).json({ error: "Vispirms atbloķē lietotāju." });
      }

      const updatedUser = await prisma.user.update({ where: { id: targetId }, data: { role } });
      return res.json({ user: { id: String(updatedUser.id), role: updatedUser.role } });
    } catch (error) {
      console.error("Admin role change failed:", error);
      return res.status(500).json({ error: "Neizdevās mainīt lietotāja tiesības." });
    }
  });

  authApp.delete("/api/admin/users/:userId", async (req, res) => {
    try {
      const admin = await getAdmin(req, res);
      if (!admin) return;

      const targetId = parseUserId(req.params.userId);
      if (targetId === null) {
        return res.status(400).json({ error: "Norādiet derīgu lietotāju." });
      }
      if (targetId === admin.id) {
        return res.status(400).json({ error: "Savu kontu dzēs profila lapā." });
      }
      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: "Lietotājs nav atrasts." });
      if (target.role === "ADMIN") {
        return res.status(400).json({ error: "Vispirms noņem administratora tiesības." });
      }
      // The typed username guards against deleting a different user than intended.
      if (req.body?.confirmUsername !== target.username) {
        return res.status(400).json({ error: "Apstiprinājumam ievadi precīzu lietotājvārdu." });
      }

      if (!(await deleteUserAccount(targetId))) {
        return res.status(409).json({
          error: "Lietotājs atrodas gaidošā istabā vai aktīvā spēlē. Mēģini vēlreiz pēc spēles beigām.",
        });
      }
      return res.status(204).end();
    } catch (error) {
      console.error("Admin account deletion failed:", error);
      return res.status(500).json({ error: "Neizdevās dzēst kontu." });
    }
  });

  authApp.use(
    "/api/friends",
    createFriendsRouter(prisma, {
      getSessionToken,
      clearSessionCookie,
    }),
  );

  const matches = createMatchService(prisma, { presence });
  const invites = createInvites();
  authApp.locals.matches = matches;
  authApp.locals.invites = invites;
  authApp.use(
    "/api/rooms",
    createRoomsRouter(prisma, { service: matches, invites })
  );


  authApp.use((error, req, res, next) => {
    if (error instanceof GameError) return res.status(error.status).json({error:error.message});
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Pieprasījums ir pārāk liels." });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Nederīgs JSON pieprasījums." });
    console.error("API error:", error);
    res.status(500).json({ error: "Servera kļūda. Mēģiniet vēlāk." });
  });
  return authApp;
}
