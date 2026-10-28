// Mocked, deliberately delayed session responses; no DB writes.
// Run after build with DURAK_PLAYWRIGHT_PATH and optionally DURAK_CHROME_PATH.
import assert from "node:assert/strict";
import express from "express";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const app = express();
app.use(express.static("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pending = [], scripts = [];
  await page.route("**/api/auth/me", (route) => { pending.push(route); });
  await page.route("**/assets/*.js", (route) => { scripts.push(route); });
  const url = base + "/src/pages%20+%20css%20stylesheet/auth.html";
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForSelector("#account-loading");
  async function assertLoading() {
    assert.equal(await page.locator("#login-form").isHidden(), true);
    assert.equal(await page.locator("#register-form").isHidden(), true);
    assert.equal(await page.locator(".auth-tabs").isHidden(), true);
    assert.equal(await page.locator("#account").isHidden(), true);
    assert.equal(await page.locator("#account-loading").isVisible(), true);
  }
  await assertLoading(); // Even before the application JavaScript has loaded.
  await page.unroute("**/assets/*.js");
  await Promise.all(scripts.map((route) => route.continue().catch(() => {})));
  await page.waitForLoadState("load");
  const next = async () => {
    const deadline = Date.now() + 5000;
    while (!pending.length) {
      assert.ok(Date.now() < deadline, "Expected session request");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return pending.shift();
  };
  const account = { user: { id: "1", username: "Player", name: "Player", email: "qa@example.invalid", avatar: null, role: "USER", theme: "DARK", themeVersion: 0 } };
  const first = await next();
  await assertLoading();
  await first.fulfill({ json: account });
  await page.waitForSelector("#account");
  assert.equal(await page.locator("#login-form").isHidden(), true);
  assert.equal(await page.locator("#account-loading").isHidden(), true);
  await page.reload();
  const cachedRequest = await next();
  await page.waitForSelector("#account");
  assert.equal(await page.locator("#account-title").textContent(), "Player");
  assert.equal(await page.locator("#login-form").isHidden(), true);
  assert.equal(await page.locator("#account-loading").textContent(), "Atjauno profilu…");
  assert.equal(await page.locator("#new-username").isDisabled(), true);
  await cachedRequest.fulfill({ json: { user: { ...account.user, username: "Updated" } } });
  await page.waitForFunction(() => document.querySelector("#account-title").textContent === "Updated");
  assert.equal(await page.locator("#new-username").isEnabled(), true);
  // A temporary error retains the preview, but keeps account mutations locked.
  await page.reload();
  const stale = await next();
  await stale.fulfill({ status: 503, json: { error: "Temporary outage" } });
  await page.waitForSelector("#retry-account");
  assert.equal(await page.locator("#account-title").textContent(), "Updated");
  assert.equal(await page.locator("#new-username").isDisabled(), true);
  assert.equal(await page.locator("#avatar-remove").isDisabled(), true);
  await page.locator("#retry-account").click();
  await (await next()).fulfill({ json: account });
  await page.waitForFunction(() => document.querySelector("#account-title").textContent === "Player");
  await page.reload();
  const guest = await next();
  assert.equal(await page.locator("#account").isVisible(), true);
  await guest.fulfill({ status: 401, json: { error: "Not signed in" } });
  await page.waitForSelector("#login-form");
  assert.equal(await page.locator("#account").isHidden(), true);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("durak-profile-preview")), null);
  assert.equal(await page.locator(".auth-tabs").isVisible(), true);
  await page.locator("#show-register").click();
  assert.equal(await page.locator("#register-form").isVisible(), true);
  await page.reload();
  const failed = await next();
  await failed.fulfill({ status: 500, json: { error: "Unavailable" } });
  await page.waitForSelector("#retry-account");
  assert.equal(await page.locator("#login-form").isHidden(), true);
  await page.locator("#retry-account").click();
  const retried = await next();
  await assertLoading();
  await retried.fulfill({ json: account });
  await page.waitForSelector("#account");
  assert.equal(await page.locator("#retry-account").isHidden(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: cached profile is visible before the server replies, refresh updates it, expired sessions clear it, errors keep it read-only; uncached login/loading/retry still work.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
