// Run after npm run build with tsx and DURAK_PLAYWRIGHT_PATH.
// Starts its own app; creates and deletes only this test's room in configured MySQL.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import express from "express";
import { createAuthApp } from "../app.js";
import { attachRealtime } from "../lib/realtime.js";
import { prisma } from "../lib/prisma.ts";
import { createMultiplayer } from "../lib/multiplayer.js";
import { createDeck } from "../src/js/game-logic.js";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const app = createAuthApp(prisma);
app.use(express.static("dist"));
const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = base;
const realtime = attachRealtime(server, app.locals.matches, { origin: base, tickMs: 60000 });
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
const code = "Q" + randomBytes(4).toString("hex").slice(0, 7).toUpperCase();
let roomId;
try {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  pages.forEach((page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
  });
  async function post(i, path, data) {
    const response = await contexts[i].request.post(base + "/api/rooms" + path, { data });
    const body = await response.json();
    assert.ok(response.ok(), JSON.stringify(body));
    return body;
  }
  await post(0, "/", { code, mode: "classic", name: "Order QA 1", allowGuests: true });
  roomId = (await prisma.match.findUnique({ where: { roomCode: code } })).id;
  for (let i = 1; i < 4; i++) await post(i, `/${code}/join`, { name: `Order QA ${i + 1}` });
  await post(0, `/${code}/start`, {});
  const room = await prisma.match.findUnique({ where: { id: roomId }, include: { players: { orderBy: { id: "asc" } } } });
  const game = createMultiplayer(room.players.map((p) => ({ id: String(p.id), name: p.guestName })), "classic", 600);
  const hands = [
    ["6_clubs", "6_hearts", "7_clubs", "8_clubs", "9_clubs", "10_clubs"],
    ["7_hearts", "8_hearts", "9_hearts", "10_hearts", "11_hearts", "12_hearts"],
    ["6_diamonds", "7_diamonds", "8_diamonds", "9_diamonds", "10_diamonds", "11_diamonds"],
    ["6_spades", "7_spades", "8_spades", "9_spades", "10_spades", "11_spades"],
  ];
  const deck = createDeck();
  game.players.forEach((p, i) => { p.hand = hands[i].map((id) => deck.find((c) => c.id === id)); });
  game.deck = deck.filter((c) => !hands.flat().includes(c.id));
  game.trumpCard = deck.find((c) => c.id === "14_spades");
  game.trumpSuit = "spades";
  game.attacker = game.players[0].id;
  game.defender = game.players[1].id;
  await prisma.match.update({ where: { id: roomId }, data: { gameState: game, version: { increment: 1 } } });
  const gameUrl = `${base}/src/pages%20+%20css%20stylesheet/game-table.html?code=${code}`;
  await Promise.all(pages.map(async (page) => {
    await page.goto(gameUrl);
    await page.waitForSelector("#player-hand .hand-card");
    await page.waitForFunction(() => document.querySelector(".multiplayer-connection").textContent === "Savienots");
  }));
  const hand = (i, id) => pages[i].locator(`[data-card-id="${id}"]`);
  await hand(0, "6_clubs").click();
  await pages[0].locator("#play-card").click();
  await pages[2].waitForSelector('[data-target-id="6_clubs"]');
  assert.equal(await hand(2, "6_diamonds").isDisabled(), true);
  assert.equal(await hand(3, "6_spades").isDisabled(), true);
  assert.equal(await pages[2].locator("#finish-attack").isHidden(), true);
  await pages[0].getByRole("button", { name: "Beigt uzbrukt", exact: true }).click();
  await pages[2].waitForFunction(() => !document.querySelector('[data-card-id="6_diamonds"]').disabled);
  assert.equal(await hand(0, "6_hearts").isDisabled(), false);
  assert.equal(await hand(3, "6_spades").isDisabled(), true);
  await pages[1].locator("#take-card").click();
  await hand(2, "6_diamonds").click();
  await pages[2].locator("#play-card").click();
  await pages[2].waitForSelector('[data-target-id="6_diamonds"]');
  await pages[2].getByRole("button", { name: "Beigt piemest", exact: true }).click();
  await pages[2].waitForFunction(() => document.querySelector("#finish-attack").hidden);
  // A primary throw-in cancels the second neighbour's earlier approval.
  await hand(0, "6_hearts").click();
  await pages[0].locator("#play-card").click();
  await pages[2].waitForFunction(() => !document.querySelector("#finish-attack").hidden);
  await pages[0].getByRole("button", { name: "Beigt piemest", exact: true }).click();
  await pages[0].waitForFunction(() => document.querySelector("#finish-attack").hidden);
  await pages[2].getByRole("button", { name: "Beigt piemest", exact: true }).click();
  await pages[2].waitForFunction(() => !document.querySelector("[data-target-id]"));
  let saved = await prisma.match.findUnique({ where: { id: roomId }, include: { players: { orderBy: { id: "asc" } } } });
  assert.equal(saved.gameState.attacker, game.players[2].id);
  assert.equal(saved.gameState.defender, game.players[3].id);
  console.log("PASS: four browsers enforce adjacent throw-ins, handoff, pickup and rotation");

  const limitGame = createMultiplayer(game.players.map((p) => ({ id: p.id, name: p.name })), "classic", 600);
  const limitHands = [hands[0].slice(0, 2), hands[1].slice(0, 2), hands[2], hands[3]];
  limitGame.players.forEach((p, i) => { p.hand = limitHands[i].map((id) => deck.find((c) => c.id === id)); });
  limitGame.deck = deck.filter((c) => !limitHands.flat().includes(c.id));
  limitGame.trumpCard = deck.find((c) => c.id === "14_spades");
  limitGame.trumpSuit = "spades";
  limitGame.attacker = limitGame.players[0].id;
  limitGame.defender = limitGame.players[1].id;
  const limitRoom = await prisma.match.update({ where: { id: roomId }, data: { gameState: limitGame, version: { increment: 1 } }, include: app.locals.matches.include });
  app.locals.matches.events.emit("changed", code, limitRoom);
  await pages[0].waitForFunction(() => document.querySelector('[data-card-id="6_clubs"]')?.disabled === false);
  await hand(0, "6_clubs").click();
  await hand(0, "6_hearts").click();
  await pages[0].locator("#play-card").click();
  await pages[1].locator("#take-card").click();
  await pages[0].getByRole("button", { name: "Beigt piemest", exact: true }).waitFor();
  await pages[2].getByRole("button", { name: "Beigt piemest", exact: true }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(await pages[0].locator("[data-target-id]").count(), 2);
  await pages[0].getByRole("button", { name: "Beigt piemest", exact: true }).click();
  await pages[0].waitForFunction(() => document.querySelector("#finish-attack").hidden);
  assert.equal(await pages[0].locator("[data-target-id]").count(), 2);
  await pages[2].getByRole("button", { name: "Beigt piemest", exact: true }).click();
  await pages[0].waitForFunction(() => !document.querySelector("[data-target-id]"));
  saved = await prisma.match.findUnique({ where: { id: roomId } });
  assert.equal(saved.gameState.bout, 1);
  assert.equal(saved.gameState.settleAt, null);
  console.log("PASS: defender hand limit waits beyond two seconds and requires both finish confirmations");

  for (const i of [3, 0]) {
    await pages[i].locator("#return-to-room").click();
    await pages[i].waitForURL("**/index.html");
    await pages[1].waitForFunction((name) => [...document.querySelectorAll(".multiplayer-seat")].some(
      (seat) => seat.querySelector("h2").textContent === name && seat.textContent.includes("Padevās")), `Order QA ${i + 1}`);
    assert.equal(await pages[1].locator("#game-result-dialog").isVisible(), false);
  }
  saved = await prisma.match.findUnique({ where: { id: roomId }, include: { players: { orderBy: { id: "asc" } } } });
  assert.equal(saved.status, "ACTIVE");
  assert.equal(saved.gameState.result, null);
  assert.deepEqual(saved.players.map((p) => p.result), ["DURAK", null, null, "DURAK"]);
  await pages[1].reload();
  await pages[1].waitForSelector("#player-hand .hand-card");
  assert.equal(await pages[1].locator("#game-result-dialog").isVisible(), false);
  await pages[2].locator("#return-to-room").click();
  await pages[2].waitForURL("**/index.html");
  await pages[1].waitForSelector("#game-result-dialog[open]");
  assert.match(await pages[1].locator("#game-result-title").textContent(), /Tu uzvarēji/);
  saved = await prisma.match.findUnique({ where: { id: roomId }, include: { players: { orderBy: { id: "asc" } } } });
  assert.equal(saved.status, "FINISHED");
  assert.deepEqual(saved.players.map((p) => p.result), ["DURAK", "WIN", "DURAK", "DURAK"]);
  await pages[0].goto(gameUrl);
  await pages[0].waitForSelector("#game-result-dialog[open]");
  assert.match(await pages[0].locator("#game-result-title").textContent(), /Tu padevies/);
  assert.equal(await pages[0].locator("#game-result-icon").getAttribute("alt"), "Zaudējums");
  assert.deepEqual(errors, []);
  console.log("PASS: 4 → 3 → 2 continue, reconnect works, and MySQL keeps all forfeits as losses");
} finally {
  await browser.close();
  realtime.cleanup();
  await new Promise((resolve) => realtime.io.close(resolve));
  try {
    if (roomId) await prisma.match.deleteMany({ where: { id: roomId, roomCode: code } });
  } finally { await prisma.$disconnect(); }
}
