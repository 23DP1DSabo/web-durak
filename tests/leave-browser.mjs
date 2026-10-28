// Recovery after reload and ordering between pending leave and a new join.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const vite = await (await import("vite")).createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
try {
  const page = await browser.newPage();
  const errors = [], pending = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ json: { user: null } }));
  await page.route("**/api/rooms**", (route) => { pending.push(route); });
  async function next(path) {
    const deadline = Date.now() + 5000;
    while (!pending.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(pending.length, `Expected ${path}`);
    const route = pending.shift();
    assert.equal(new URL(route.request().url()).pathname, path);
    return route;
  }
  const index = `${base}/src/pages%20+%20css%20stylesheet/index.html`;
  await page.goto(index);
  await page.evaluate(() => sessionStorage.setItem("durak-pending-room-exit", JSON.stringify({ code: "LEFTROOM", membershipId: "123" })));
  await page.reload({ waitUntil: "domcontentloaded" });
  const leave = await next("/api/rooms/LEFTROOM/leave");
  assert.equal(leave.request().postDataJSON().membershipId, "123");
  await leave.fulfill({ status: 503, json: { error: "Offline" } });
  await page.waitForFunction(() => !document.querySelector("#retry-room-exit").hidden);
  await page.reload({ waitUntil: "domcontentloaded" });
  const resumed = await next("/api/rooms/LEFTROOM/leave");
  await page.locator('[data-room-mode="classic"]').click();
  await page.locator('[data-room-action="create"]').click();
  assert.equal(pending.length, 0, "A new create must wait for pending membership cleanup");
  assert.equal(await page.locator('[data-room-action="create"]').isDisabled(), true);
  // The first response may have been lost after the server removed membership.
  await resumed.fulfill({ status: 403, json: { code: "NOT_ROOM_MEMBER", error: "Already left" } });
  const create = await next("/api/rooms");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("durak-pending-room-exit")), null);
  await create.fulfill({ status: 503, json: { error: "Creation failure" } });
  await page.waitForFunction(() => !document.querySelector('[data-room-action="create"]').disabled);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(pending.length, 0, "Completed leave is not repeated after reload");
  assert.deepEqual(errors, []);
  console.log("PASS: reload resumes failed leave; creation waits; completed cleanup is removed");
} finally {
  await browser.close();
  await vite.close();
}
