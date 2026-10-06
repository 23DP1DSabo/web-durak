import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { prisma } from "./lib/prisma.ts";

const authApp = express();
const port = Number(process.env.PORT ?? 3002);
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const scryptAsync = promisify(scrypt);

authApp.use(express.json());

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
  return sessionCookie?.slice("durak_session=".length);
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

async function createSession(userId, res) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + sessionDuration });
  setSessionCookie(res, token);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${Buffer.from(hash).toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, savedHash] = storedHash.split(":");
  if (!salt || !savedHash) return false;

  const hash = await scryptAsync(password, salt, 64);
  const savedBuffer = Buffer.from(savedHash, "hex");
  return savedBuffer.length === hash.length && timingSafeEqual(savedBuffer, hash);
}

function validCredentials(email, password) {
  return typeof email === "string"
    && email.length <= 191
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && typeof password === "string"
    && password.length >= 8
    && password.length <= 128;
}

authApp.post("/api/auth/register", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body?.password;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;

  if (!validCredentials(email, password) || (name && name.length > 191)) {
    return res.status(400).json({ error: "Enter a valid email and a password of at least 8 characters." });
  }

  try {
    const user = await prisma.user.create({
      data: { email, name: name || null, passwordHash: await hashPassword(password) },
    });
    await createSession(user.id, res);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    console.error("Registration failed:", error);
    return res.status(500).json({ error: "Unable to create account." });
  }
});

authApp.post("/api/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body?.password;

  if (!validCredentials(email, password)) {
    return res.status(400).json({ error: "Enter a valid email and password." });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }

    await createSession(user.id, res);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Unable to log in." });
  }
});

authApp.get("/api/auth/me", async (req, res) => {
  const token = getSessionToken(req);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not logged in." });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      sessions.delete(token);
      clearSessionCookie(res);
      return res.status(401).json({ error: "Not logged in." });
    }
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Session lookup failed:", error);
    return res.status(500).json({ error: "Unable to check login status." });
  }
});

authApp.post("/api/auth/logout", (req, res) => {
  const token = getSessionToken(req);
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.status(204).end();
});

authApp.listen(port, () => {
  console.log(`API server is running on http://localhost:${port}`);
});