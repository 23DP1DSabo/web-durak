// Run with tsx and DURAK_PLAYWRIGHT_PATH pointing to an installed Playwright module.
// Uses a running app and creates/deletes only this test's own rooms.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { prisma } from "../lib/prisma.ts";
import { createMultiplayer } from "../lib/multiplayer.js";
import { createDeck } from "../src/js/game-logic.js";
const { chromium } = await import(
  process.env.DURAK_PLAYWRIGHT_PATH || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DURAK_CHROME_PATH
    ? { executablePath: process.env.DURAK_CHROME_PATH }
    : {}),
});
const base = process.env.DURAK_TEST_ORIGIN || "http://localhost:3000";
const output = join(tmpdir(), "durak-drag-qa");
await mkdir(output, { recursive: true });
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1366, height: 900 } }),
  browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  }),
]);
const pages = await Promise.all(contexts.map((c) => c.newPage()));
const errors = [];
pages.forEach((p) => p.on("pageerror", (e) => errors.push(e.message)));
const ownRooms = [];
const post = async (i, path, data) => {
  const response = await contexts[i].request.post(base + "/api/rooms" + path, {
    data,
  });
  const body = await response.json();
  assert.ok(response.ok(), JSON.stringify(body));
  return body;
};
const cardIds = [
  ["6_clubs", "6_hearts", "6_diamonds", "7_diamonds", "9_clubs", "10_clubs"],
  ["7_hearts", "8_clubs", "6_spades", "9_hearts", "10_hearts", "11_hearts"],
];
async function createRoom(solo = false) {
  const code = "D" + randomBytes(4).toString("hex").slice(0, 7).toUpperCase();
  await post(0, "/", {
    code,
    mode: "passing",
    name: "Drag QA A",
    allowGuests: true,
  });
  const room = await prisma.match.findUnique({
    where: { roomCode: code },
    include: { players: true },
  });
  ownRooms.push({ id: room.id, roomCode: code });
  if (!solo) await post(1, `/${code}/join`, { name: "Drag QA B" });
  await post(0, `/${code}/start`, {});
  if (!solo) {
    const saved = await prisma.match.findUnique({
      where: { id: room.id },
      include: { players: { orderBy: { id: "asc" } } },
    });
    const game = createMultiplayer(
      saved.players.map((p) => ({ id: String(p.id), name: p.guestName })),
      "passing",
      600,
    );
    const deck = createDeck();
    game.players.forEach((p, i) => {
      p.hand = cardIds[i].map((id) => deck.find((c) => c.id === id));
    });
    game.deck = deck.filter((c) => !cardIds.flat().includes(c.id));
    game.trumpCard = deck.find((c) => c.id === "14_spades");
    game.trumpSuit = "spades";
    game.attacker = game.players[0].id;
    game.defender = game.players[1].id;
    await prisma.match.update({
      where: { id: room.id },
      data: { gameState: game, version: { increment: 1 } },
    });
  }
  return code;
}
async function openGame(code) {
  await Promise.all(
    pages.map((p) =>
      p.goto(
        base + "/src/pages%20+%20css%20stylesheet/game-table.html?code=" + code,
      ),
    ),
  );
  await Promise.all(
    pages.map((p) =>
      p.waitForSelector("#player-hand .hand-card", { timeout: 20000 }),
    ),
  );
}
const hand = (p, id) => p.locator(`[data-card-id="${id}"]`);
async function drag(
  p,
  source,
  target,
  { touch = false, outside = false } = {},
) {
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox(),
    b = outside
      ? { x: 1, y: 1, width: 4, height: 4 }
      : await target.boundingBox();
  assert.ok(a && b, "drag targets must exist");
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 },
    end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (touch) {
    const session = await p.context().newCDPSession(p);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (let i = 1; i <= 10; i++)
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * i) / 10,
            y: start.y + ((end.y - start.y) * i) / 10,
          },
        ],
      });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  } else {
    await p.mouse.move(start.x, start.y);
    await p.mouse.down();
    await p.mouse.move(end.x, end.y, { steps: 12 });
    await p.mouse.up();
  }
}
const waitAttacks = (n) =>
  Promise.all(
    pages.map((p) =>
      p.waitForFunction(
        (n) => document.querySelectorAll(".attack-card").length === n,
        n,
      ),
    ),
  );
try {
  const code = await createRoom();
  await openGame(code);
  await drag(pages[0], hand(pages[0], "6_clubs"), null, { outside: true });
  assert.equal(await pages[0].locator("#player-hand .hand-card").count(), 6);
  assert.equal(await pages[0].locator(".attack-card").count(), 0);
  await hand(pages[0], "6_clubs").click();
  await hand(pages[0], "6_hearts").click();
  assert.equal(
    await pages[0].locator('.hand-card[aria-pressed="true"]').count(),
    2,
  );
  await drag(
    pages[0],
    hand(pages[0], "6_clubs"),
    pages[0].locator('[data-drop-kind="attack"]'),
  );
  await waitAttacks(2);
  await drag(
    pages[1],
    hand(pages[1], "7_hearts"),
    pages[1].locator('[data-target-id="6_clubs"]'),
    { touch: true },
  );
  assert.equal(await pages[1].locator(".defense-card").count(), 0);
  await drag(
    pages[1],
    hand(pages[1], "7_hearts"),
    pages[1].locator('[data-target-id="6_hearts"]'),
    { touch: true },
  );
  await pages[1].waitForSelector('[data-target-id="6_hearts"] .defense-card');
  assert.equal(
    await pages[1].locator('[data-target-id="6_clubs"] .defense-card').count(),
    0,
  );
  await drag(
    pages[0],
    hand(pages[0], "7_diamonds"),
    pages[0].locator('[data-drop-kind="attack"]'),
  );
  await waitAttacks(3);
  await pages[0].screenshot({
    path: join(output, "desktop.png"),
    fullPage: true,
  });
  await pages[1].screenshot({
    path: join(output, "mobile.png"),
    fullPage: true,
  });
  await pages[1].locator("#take-card").click();
  await pages[0].waitForFunction(
    () =>
      document.querySelector("#finish-attack").textContent === "Beigt piemest",
  );
  assert.equal(await pages[1].locator("#player-hand .hand-card").count(), 5);
  await drag(
    pages[0],
    hand(pages[0], "6_diamonds"),
    pages[0].locator('[data-drop-kind="attack"]'),
  );
  await waitAttacks(4);
  await pages[0].locator("#finish-attack").click();
  await waitAttacks(0);
  assert.equal(await pages[1].locator("#player-hand .hand-card").count(), 10);
  await pages[1].reload();
  await pages[1].waitForFunction(
    () => document.querySelectorAll("#player-hand .hand-card").length === 10,
  );
  console.log(
    "PASS: batch mouse drag, targeted touch defense out of order, throw-in during defense, deferred pickup, reconnect.",
  );
  const passCode = await createRoom();
  await openGame(passCode);
  await drag(
    pages[0],
    hand(pages[0], "6_clubs"),
    pages[0].locator('[data-drop-kind="attack"]'),
  );
  await waitAttacks(1);
  await drag(
    pages[1],
    hand(pages[1], "6_spades"),
    pages[1].locator('[data-drop-kind="pass"]'),
    { touch: true },
  );
  await waitAttacks(2);
  await pages[0].waitForSelector("#take-card:visible");
  assert.equal(await pages[1].locator("#take-card:visible").count(), 0);
  console.log("PASS: touch transfer via separate drop zone changes defender.");
  const soloCode = await createRoom(true);
  await pages[0].goto(
    base + "/src/pages%20+%20css%20stylesheet/game-table.html?code=" + soloCode,
  );
  await pages[0].waitForSelector("#player-hand .hand-card");
  assert.equal(
    await pages[0].locator(".multiplayer-seat h2").textContent(),
    "Bots",
  );
  assert.match(
    await pages[0].locator("#match-time-limit").textContent(),
    /botu/,
  );
  await pages[0].reload();
  await pages[0].waitForSelector("#player-hand .hand-card");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: same table loads against bot and survives reload; no browser errors.",
  );
  console.log("Screenshots: " + output);
} catch (error) {
  await Promise.all(
    pages.map((p, i) =>
      p
        .screenshot({ path: join(output, `failure-${i}.png`), fullPage: true })
        .catch(() => {}),
    ),
  );
  console.log("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
  for (const where of ownRooms) await prisma.match.deleteMany({ where });
  await prisma.$disconnect();
}
