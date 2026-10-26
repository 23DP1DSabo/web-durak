// Requires a running Vite app; API responses are mocked, so no database is used.
// Set DURAK_PLAYWRIGHT_PATH and optionally DURAK_CHROME_PATH as in table-browser.mjs.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// Trigger polling explicitly so response ordering is deterministic.
await page.addInitScript(() => {
  const original = window.setInterval;
  window.setInterval = (callback, delay, ...args) => {
    if (delay === 2000) {
      window.testRefreshRoom = callback;
      return 0;
    }
    return original(callback, delay, ...args);
  };
});
const pending = [];
let state = {
  code: "ROOMTEST", mode: "classic", status: "waiting", version: 0,
  selfId: "host", hostId: "host", allowGuests: false, timeLimitSeconds: 600,
  players: [{ id: "host", name: "Host", role: "host" }],
};
await page.route("**/api/rooms**", (route) => {
  pending.push({ route, method: route.request().method(), body: route.request().postDataJSON() });
});
async function next(method) {
  const deadline = Date.now() + 5000;
  while (!pending.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(pending.length, `Expected ${method} request`);
  const request = pending.shift();
  assert.equal(request.method, method);
  return request;
}
async function respond(request, room = state) {
  await request.route.fulfill({ json: { room } });
}
async function saved() {
  await page.waitForFunction(() => !document.querySelector("#begin-match").disabled);
}
const guests = page.locator("#allow-guests");
try {
  const base = process.env.DURAK_TEST_ORIGIN || "http://localhost:3000";
  await page.goto(`${base}/src/pages%20%2B%20css%20stylesheet/room.html?code=ROOMTEST&mode=classic&role=host`);
  const create = await next("POST");
  assert.equal(create.body.allowGuests, false);
  await guests.check();
  await page.locator('input[name="time-limit"][value="180"]').check();
  assert.equal(pending.length, 0, "Do not save before room creation finishes");
  await respond(create);
  const initialSave = await next("PATCH");
  assert.equal(initialSave.body.allowGuests, true);
  assert.equal(initialSave.body.timeLimitSeconds, 180);
  assert.equal(await guests.isChecked(), true);
  assert.equal(await page.locator("#begin-match").isDisabled(), true);
  state = { ...state, allowGuests: true, timeLimitSeconds: 180, version: 1 };
  await respond(initialSave);
  await saved();
  console.log("PASS: early settings changes survive delayed creation");

  await guests.uncheck();
  const firstSave = await next("PATCH");
  await guests.check();
  await page.locator('input[name="time-limit"][value="60"]').check();
  assert.equal(pending.length, 0, "Only one settings save may be in flight");
  state = { ...state, allowGuests: false, version: 2 };
  await respond(firstSave);
  const latestSave = await next("PATCH");
  assert.equal(await guests.isChecked(), true, "Older save must not replace latest intent");
  assert.equal(latestSave.body.allowGuests, true);
  assert.equal(latestSave.body.timeLimitSeconds, 60);
  state = { ...state, allowGuests: true, timeLimitSeconds: 60, version: 3 };
  await respond(latestSave);
  await saved();
  console.log("PASS: rapid changes are serialized and latest choice is saved");

  await page.evaluate(() => { window.testRefreshPending = window.testRefreshRoom(); });
  const oldPoll = await next("GET");
  const oldState = { ...state };
  await guests.uncheck();
  const newerSave = await next("PATCH");
  state = { ...state, allowGuests: false, version: 4 };
  await respond(newerSave);
  await saved();
  await respond(oldPoll, oldState);
  await page.evaluate(() => window.testRefreshPending);
  assert.equal(await guests.isChecked(), false, "Stale poll must not roll settings back");
  console.log("PASS: stale polling response cannot overwrite saved settings");

  await guests.check();
  const failedSave = await next("PATCH");
  await failedSave.route.fulfill({ status: 503, json: { error: "Test failure" } });
  await page.waitForFunction(() => document.querySelector("#room-status").textContent.includes("Test failure"));
  assert.equal(await guests.isChecked(), false, "Failed save shows last confirmed setting");
  await saved();
  await guests.check();
  const retry = await next("PATCH");
  state = { ...state, allowGuests: true, version: 5 };
  await respond(retry);
  await saved();
  assert.equal(await guests.isChecked(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: failed save is visible and the next change can be saved");
} finally {
  await browser.close();
}
