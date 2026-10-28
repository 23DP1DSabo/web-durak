// Browser regression for creation/join handoff; mocked API, no database writes.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const vite = process.env.DURAK_TEST_ORIGIN ? null : await (await import("vite")).createServer({
  server: { host: "127.0.0.1", port: 0 }, logLevel: "error",
});
await vite?.listen();
const base = process.env.DURAK_TEST_ORIGIN || `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: null } }));
  const requests = [], pending = [];
  let room = { code: "HANDOFF1", mode: "classic", status: "waiting", version: 0,
    selfId: "host", hostId: "host", timeLimitSeconds: 600, allowGuests: false,
    players: [{ id: "host", name: "Server account name", role: "host" }],
  };
  await page.route("**/api/rooms**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { room } });
    const request = { route, path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() };
    requests.push(request);
    pending.push(request);
  });
  async function next(path) {
    const deadline = Date.now() + 5000;
    while (!pending.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(pending.length, `Expected request ${path}`);
    const request = pending.shift();
    assert.equal(request.path, path);
    return request;
  }
  const index = `${base}/src/pages%20+%20css%20stylesheet/index.html`;
  async function openChoice() {
    await page.goto(index);
    await page.locator('[data-room-mode="classic"]').click();
  }
  async function ready() {
    await page.waitForURL("**/room.html?**");
    await page.waitForFunction(() => !document.querySelector(".room-lobby").hidden);
    assert.equal(await page.locator("#room-loading").isHidden(), true);
    assert.match(await page.locator("#player-list").textContent(), /Server account name/);
    assert.equal(new URL(page.url()).searchParams.has("handoff"), false);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("durak-room-handoff")), null);
  }
  await openChoice();
  const createButton = page.locator('[data-room-action="create"]');
  await createButton.click();
  const failed = await next("/api/rooms");
  assert.match(page.url(), /index.html/);
  assert.equal(await createButton.isDisabled(), true);
  assert.equal(await createButton.textContent(), "Veido istabu...");
  await page.evaluate(() => document.querySelector('[data-room-action="create"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
  assert.equal(requests.length, 1);
  await failed.route.fulfill({ status: 503, json: { error: "Temporary create error" } });
  await page.waitForFunction(() => !document.querySelector('[data-room-action="create"]').disabled);
  assert.match(await page.locator("#create-room-message").textContent(), /Temporary create error/);
  await createButton.click();
  const created = await next("/api/rooms");
  assert.equal(created.body.code, failed.body.code, "Retry the same code after an uncertain response");
  room.code = created.body.code;
  await created.route.fulfill({ json: { room } });
  await ready();
  assert.equal(requests.length, 2, "Room page must not repeat creation after handoff");
  assert.equal(await page.locator("#begin-match").isEnabled(), true);
  console.log("PASS: creation starts on click, duplicate clicks are blocked, errors can be retried, ready room needs no second POST");

  const previousCode = room.code;
  await page.goBack();
  await page.waitForURL("**/index.html");
  if (!(await page.locator("#room-choice-dialog").evaluate((el) => el.open))) {
    await page.locator('[data-room-mode="classic"]').click();
  }
  assert.equal(await createButton.isEnabled(), true);
  await createButton.click();
  const afterBack = await next("/api/rooms");
  assert.notEqual(afterBack.body.code, previousCode);
  room.code = afterBack.body.code;
  await afterBack.route.fulfill({ json: { room } });
  await ready();
  console.log("PASS: browser Back restores usable creation controls");

  await page.reload();
  const reload = await next("/api/rooms");
  assert.equal(await page.locator(".room-lobby").isHidden(), true);
  room = { ...room, allowGuests: true, timeLimitSeconds: 60, version: 1 };
  await reload.route.fulfill({ json: { room } });
  await ready();
  assert.equal(await page.locator("#allow-guests").isChecked(), true);
  assert.equal(await page.locator('input[name="time-limit"][value="60"]').isChecked(), true);
  console.log("PASS: refresh consumes no stale cache and displays fresh server settings");

  await page.goto(index);
  const countBeforeQuick = requests.length;
  await page.locator("#quick-game-classic").click();
  const quick = await next("/api/rooms/quickplay");
  room = { ...room, selfId: "guest", players: [...room.players, { id: "guest", name: "Guest", role: "player" }] };
  await quick.route.fulfill({ json: { room } });
  await ready();
  assert.equal(requests.length, countBeforeQuick + 1);
  assert.equal(await page.locator("#begin-match").isHidden(), true);
  console.log("PASS: quickplay reuses its joined room instead of joining again");

  await openChoice();
  const countBeforeJoin = requests.length;
  await page.locator('[data-room-action="show-join"]').click();
  await page.locator("#room-code-input").fill(room.code);
  await page.locator('#join-room-form [type="submit"]').click();
  const joined = await next(`/api/rooms/${room.code}/join`);
  await joined.route.fulfill({ json: { room } });
  await ready();
  assert.equal(requests.length, countBeforeJoin + 1);
  console.log("PASS: code entry joins directly and opens the ready room with one POST");

  await page.evaluate((room) => sessionStorage.setItem("durak-room-handoff", JSON.stringify({ token: "expired", room, expiresAt: 0 })), room);
  await page.goto(`${base}/src/pages%20+%20css%20stylesheet/room.html?code=${room.code}&mode=classic&role=player&handoff=expired`);
  const expired = await next(`/api/rooms/${room.code}/join`);
  assert.equal(await page.locator(".room-lobby").isHidden(), true);
  await expired.route.fulfill({ json: { room } });
  await ready();
  assert.deepEqual(errors, []);
  console.log("PASS: expired handoff falls back to the server instead of showing stale data");
} finally {
  await browser.close();
  await vite?.close();
}
