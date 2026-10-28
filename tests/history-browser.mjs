// Real DB/server/browser check. Creates and removes only uniquely named QA records.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import express from "express";
import { createAuthApp } from "../app.js";
import { prisma } from "../lib/prisma.ts";
import { archiveRound } from "../lib/history.js";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const app = createAuthApp(prisma); app.use(express.static("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = base;
const browser = await chromium.launch({ headless: true, ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}) });
const users = [], cookies = [], tokens = [], code = randomBytes(4).toString("hex").toUpperCase();
let matchId;
async function api(path, i = 0, body) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: {
    cookie: cookies[i] || "", "Content-Type": "application/json",
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${path}: ${response.status}`); return response.json();
}
try {
  for (let i = 0; i < 3; i++) {
    const username = "HistoryQA_" + randomBytes(6).toString("hex");
    const user = await prisma.user.create({ data: { username, name: "Vēstures pārbaude", email: username + "@example.invalid", passwordHash: "test-only-no-login", theme: "MODERN" } });
    users.push(user); const token = randomBytes(32).toString("hex"); tokens.push(token);
    await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
    cookies.push("durak_session=" + token);
  }
  await api("/api/rooms", 0, { code, mode: "classic", allowGuests: false, name: users[0].username });
  matchId = (await prisma.match.findUnique({ where: { roomCode: code } })).id;
  await api(`/api/rooms/${code}/join`, 1, { name: users[1].username });
  await api(`/api/rooms/${code}/start`, 0, {});
  const service = app.locals.matches;
  const identities = await Promise.all(cookies.slice(0, 2).map(cookie => service.identity({ headers: { cookie } })));
  async function timeoutPlayer(index) {
    const room = await service.load(code), game = structuredClone(room.gameState);
    game.attacker = String(room.players[index].id); game.defender = String(room.players[1 - index].id);
    game.players.find(p => p.id === game.attacker).movesMade = 1;
    game.updatedAt = Date.now() - 700000;
    await prisma.match.update({ where: { id: matchId }, data: { gameState: game } });
    return service.expireRoom(code);
  }
  let room = await timeoutPlayer(0);
  assert.equal(await prisma.matchRound.count({ where: { matchId } }), 1);
  // A replay cannot duplicate or alter the immutable archived round.
  await archiveRound(prisma, room, room.gameState, room.endedAt);
  assert.equal(await prisma.matchRound.count({ where: { matchId } }), 1);
  room = await service.readyNextRound(code, identities[0], room.version);
  room = await service.readyNextRound(code, identities[1], room.version);
  assert.equal(room.status, "ACTIVE");
  assert.equal(await prisma.matchRound.count({ where: { matchId } }), 1);
  room = await timeoutPlayer(1);
  assert.equal(await prisma.matchRound.count({ where: { matchId } }), 2);
  assert.deepEqual((await api("/api/me/statistics")).statistics, { total: 2, wins: 1, losses: 1, draws: 0, winRate: 50 });
  const history = await api("/api/me/history");
  assert.equal(history.games.length, 2);
  assert.deepEqual(history.games.map(g => g.result), ["WIN", "DURAK"]);
  assert.equal(history.games[0].players.find(p => p.isSelf).name, users[0].username);
  assert.equal((await api("/api/me/history", 2)).games.length, 0);
  assert.equal((await fetch(base + "/api/me/history")).status, 401);
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await context.addCookies([{ name: "durak_session", value: tokens[0], url: base }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = name => base + `/src/pages%20+%20css%20stylesheet/${name}.html`;
  let releaseStatistics;
  await page.route("**/api/me/statistics", route => { releaseStatistics = () => route.continue(); });
  await page.goto(url("auth"));
  await page.locator("#account").waitFor({ state: "visible" });
  assert.equal(await page.locator("#login-form").isVisible(), false);
  assert.equal(await page.locator('[data-stat="total"]').textContent(), "—");
  await page.waitForFunction(() => document.querySelector("#profile-statistics").getAttribute("aria-busy") === "true");
  while (!releaseStatistics) await new Promise(r => setTimeout(r, 20));
  await releaseStatistics(); await page.unroute("**/api/me/statistics");
  await page.waitForFunction(() => document.querySelector('[data-stat="total"]').textContent === "2");
  const directory = process.env.TEMP + "/durak-history-qa"; await mkdir(directory, { recursive: true });
  for (const theme of ["classic", "light", "dark", "modern"]) {
    await page.evaluate(theme => document.body.dataset.theme = theme, theme);
    await page.screenshot({ path: `${directory}/profile-${theme}.png`, fullPage: true });
  }
  await page.locator('a[href="./history.html"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".history-card").length === 2);
  for (const [size, width] of [["desktop", 1366], ["mobile", 390]]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["classic", "light", "dark", "modern"]) {
      await page.evaluate(theme => document.body.dataset.theme = theme, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${directory}/history-${theme}-${size}.png`, fullPage: true });
    }
  }
  await page.route("**/api/me/history*", route => route.fulfill({ status: 503, json: { error: "Test outage" } }));
  await page.reload(); await page.getByRole("button", { name: "Mēģināt vēlreiz" }).waitFor();
  await page.unroute("**/api/me/history*"); await page.getByRole("button", { name: "Mēģināt vēlreiz" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".history-card").length === 2);
  await context.clearCookies(); await page.reload();
  await page.locator("#history-login").waitFor({ state: "visible" });
  assert.equal(await page.locator(".history-card").count(), 0);
  assert.deepEqual(errors, []);
  // Account deletion preserves anonymous results without retaining the username.
  await prisma.matchPlayer.updateMany({ where: { userId: users[1].id }, data: { userId: null, guestName: "Dzēsts lietotājs" } });
  await prisma.user.delete({ where: { id: users[1].id } });
  assert.equal((await api("/api/me/history")).games[0].players[1].name, "Dzēsts lietotājs");
  console.log("PASS: real DB completion/rematch/idempotence, statistics, account isolation, anonymization, profile loading, all themes/mobile, error retry and guest login. Screenshots: " + directory);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  try {
    if (matchId) await prisma.match.delete({ where: { id: matchId } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  } finally { await prisma.$disconnect(); }
}
