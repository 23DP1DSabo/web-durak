// Run after build and migrations with tsx. Uses configured DB and removes only its own QA account.
// DURAK_PLAYWRIGHT_PATH / DURAK_CHROME_PATH work as in the other browser checks.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import sharp from "sharp";
import { createAuthApp } from "../app.js";
import { attachRealtime } from "../lib/realtime.js";
import { prisma } from "../lib/prisma.ts";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const app = createAuthApp(prisma);
app.use(express.static("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = base;
// Do not discover or advance unrelated games in the shared database.
const realtime = attachRealtime(server, { ...app.locals.matches, activeClocks: async () => [] }, { origin: base, tickMs: 60000 });
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
const suffix = randomBytes(6).toString("hex");
const username = `Speletajs_${suffix.slice(0, 5)}`;
const credentials = { username, name: "Spēlētājs", email: `profile_${suffix}@example.invalid`, password: randomBytes(20).toString("hex") };
let userId, otherUserId, roomId;
const output = join(tmpdir(), "durak-profile-qa");
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1100 } });
  const registered = await context.request.post(base + "/api/auth/register", { data: credentials });
  assert.equal(registered.status(), 201);
  userId = BigInt((await registered.json()).user.id);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = base + "/src/pages%20+%20css%20stylesheet/auth.html";
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#auth-panel").getAttribute("aria-busy") === "false");
  assert.equal(await page.locator("#account-title").textContent(), username);
  assert.equal(await page.locator("#avatar-save").isDisabled(), true);
  const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#4b83a8" } }).png().toBuffer();
  const file = { name: "mans-profils.png", mimeType: "image/png", buffer: image };
  await page.locator("#avatar-file").setInputFiles(file);
  assert.ok((await page.locator("#profile-avatar img").getAttribute("src")).startsWith("blob:"));
  assert.equal((await prisma.user.findUnique({ where: { id: userId } })).avatar, null);
  await page.locator("#avatar-cancel").click();
  assert.equal(await page.locator("#profile-avatar img").count(), 0);
  assert.equal(await page.locator("#avatar-save").isDisabled(), true);
  await page.locator("#avatar-file").setInputFiles(file);
  await page.locator("#avatar-save").click();
  await page.waitForFunction(() => document.querySelector("#avatar-message").textContent === "Profila bilde saglabāta.");
  const stored = await prisma.user.findUnique({ where: { id: userId } });
  const savedImage = await prisma.userAvatar.findUnique({ where: { userId } });
  assert.ok(savedImage.image.length > 0);
  assert.equal((await context.request.get(base + stored.avatar)).status(), 200);
  await page.reload();
  await page.waitForSelector("#profile-avatar img");
  await page.waitForFunction(() => document.querySelector("#profile-avatar img").naturalWidth === 512);
  // A separate server instance must serve the same database-backed picture.
  const otherServer = createAuthApp(prisma).listen(0, "127.0.0.1");
  await new Promise((resolve) => otherServer.once("listening", resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${otherServer.address().port}${stored.avatar}`);
    assert.equal(result.status, 200);
    assert.ok(Buffer.from(await result.arrayBuffer()).equals(Buffer.from(savedImage.image)));
  } finally { await new Promise((resolve) => otherServer.close(resolve)); }
  await page.locator("#new-username").fill("A".repeat(50));
  await page.locator("#username-form button").click();
  await page.waitForFunction(() => document.querySelector("#account-title").textContent.length === 50);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator("#new-username").fill(username);
  await page.locator("#username-form button").click();
  await page.waitForFunction((name) => document.querySelector("#account-title").textContent === name, username);
  for (const [name, width, theme] of [["desktop-dark", 1366, "dark"], ["desktop-light", 1366, "light"], ["mobile", 390, "dark"]]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
    await page.evaluate((theme) => { document.body.dataset.theme = theme; window.scrollTo(0, 0); }, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, name + ".png"), fullPage: true });
  }
  await page.locator("#avatar-file").setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  assert.equal(await page.locator("#avatar-save").isDisabled(), true);
  assert.equal(await page.locator("#avatar-message").textContent(), "Izvēlies JPG, PNG vai WebP attēlu līdz 5 MB.");
  // A failed upload leaves the saved picture intact and allows a retry.
  await page.route("**/api/auth/avatar", (route) => route.fulfill({ status: 500, json: { error: "Pārbaudes kļūda" } }));
  await page.locator("#avatar-file").setInputFiles(file);
  await page.locator("#avatar-save").click();
  await page.waitForFunction(() => document.querySelector("#avatar-message").textContent === "Pārbaudes kļūda");
  assert.equal((await prisma.user.findUnique({ where: { id: userId } })).avatar, stored.avatar);
  assert.equal(await page.locator("#avatar-save").isEnabled(), true);
  await page.unroute("**/api/auth/avatar");
  await page.locator("#avatar-cancel").click();
  await page.locator("#avatar-remove").click();
  await page.waitForFunction(() => document.querySelector("#avatar-message").textContent === "Profila bilde noņemta.");
  assert.equal(await prisma.userAvatar.findUnique({ where: { userId } }), null);
  assert.equal(await page.locator("#profile-avatar img").count(), 0);
  await page.locator("#avatar-file").setInputFiles(file);
  await page.locator("#avatar-save").click();
  await page.waitForFunction(() => document.querySelector("#avatar-message").textContent === "Profila bilde saglabāta.");
  // The uploaded avatar is visible to another player in friend search, lobby and game.
  const other = await browser.newContext();
  const secondRegistration = await other.request.post(base + "/api/auth/register", { data: {
    ...credentials, username: `Other_${suffix}`, email: `other_${suffix}@example.invalid`,
  } });
  assert.equal(secondRegistration.status(), 201);
  otherUserId = BigInt((await secondRegistration.json()).user.id);
  const otherPage = await other.newPage();
  otherPage.on("pageerror", (error) => errors.push(error.message));
  await otherPage.goto(base + "/src/pages%20+%20css%20stylesheet/friends.html");
  await otherPage.locator("#friend-username").fill(username);
  await otherPage.locator("#friend-search-form button").click();
  await otherPage.waitForFunction(() => document.querySelector("#friend-search-results img")?.naturalWidth === 512);
  const code = "P" + randomBytes(4).toString("hex").slice(0, 7).toUpperCase();
  const created = await context.request.post(base + "/api/rooms", { data: { code, mode: "classic", name: username } });
  assert.equal(created.status(), 201);
  roomId = (await prisma.match.findUnique({ where: { roomCode: code } })).id;
  await otherPage.goto(base + `/src/pages%20+%20css%20stylesheet/room.html?code=${code}&mode=classic&role=player`);
  await otherPage.waitForFunction(() => document.querySelector("#player-list img")?.naturalWidth === 512);
  await otherPage.screenshot({ path: join(output, "lobby.png"), fullPage: true });
  assert.equal((await context.request.post(base + `/api/rooms/${code}/start`, { data: {} })).status(), 200);
  await otherPage.waitForURL("**/game-table.html?**");
  await otherPage.waitForFunction(() => document.querySelector(".multiplayer-seat .user-avatar img")?.naturalWidth === 512);
  await page.goto(base + `/src/pages%20+%20css%20stylesheet/game-table.html?code=${code}`);
  await page.waitForFunction(() => document.querySelector(".player-avatar img")?.naturalWidth === 512);
  await otherPage.screenshot({ path: join(output, "game.png"), fullPage: true });
  await otherPage.close();
  await page.goto(url);
  await page.waitForSelector("#profile-avatar img");
  await prisma.match.delete({ where: { id: roomId } });
  roomId = null;
  const deleted = await context.request.delete(base + "/api/auth/account", { data: { currentPassword: credentials.password } });
  assert.equal(deleted.status(), 204);
  assert.equal(await prisma.userAvatar.findUnique({ where: { userId } }), null);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#auth-panel").getAttribute("aria-busy") === "false");
  assert.equal(await page.locator("#login-form").isVisible(), true);
  assert.equal(await page.locator("#account").isHidden(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: profile preview, cancel, upload, reload, cross-instance persistence, username, mobile/themes, failure, removal, account cascade and friend/lobby/game avatars.");
  console.log("Screenshots: " + output);
} finally {
  await browser.close();
  realtime.cleanup();
  await new Promise((resolve) => realtime.io.close(resolve));
  if (roomId) await prisma.match.deleteMany({ where: { id: roomId } });
  if (otherUserId) await prisma.user.deleteMany({ where: { id: otherUserId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
}
