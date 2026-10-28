// Real browser + configured DB. Delays requests deterministically and deletes only its own QA account.
// Run with tsx after build/migrate, using DURAK_PLAYWRIGHT_PATH and DURAK_CHROME_PATH.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import { createAuthApp } from "../app.js";
import { prisma } from "../lib/prisma.ts";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const app = express();
let holdReads = false, holdNextWrite = false, reads = [], writes = [], conflicts = 0;
app.use((req, res, next) => {
  if (req.path === "/api/auth/me" && holdReads) {
    const json = res.json.bind(res);
    res.json = (body) => { reads.push(() => json(body)); return res; };
  }
  if (req.path === "/api/auth/theme" && req.method === "PATCH") {
    res.on("finish", () => { if (res.statusCode === 409) conflicts++; });
    if (holdNextWrite) { holdNextWrite = false; writes.push(next); return; }
  }
  next();
});
app.use(createAuthApp(prisma));
app.use(express.static("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = base;
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
const suffix = randomBytes(6).toString("hex");
let userId;
const waitUntil = async (predicate) => {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for controlled request");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const releaseReads = () => { holdReads = false; const pending = reads; reads = []; pending.forEach((release) => release()); };
try {
  const context = await browser.newContext();
  const register = await context.request.post(base + "/api/auth/register", { data: {
    username: `Theme_${suffix}`, name: "Theme QA", email: `theme_${suffix}@example.invalid`, password: randomBytes(20).toString("hex"),
  } });
  assert.equal(register.status(), 201);
  userId = BigInt((await register.json()).user.id);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = (name) => base + `/src/pages%20+%20css%20stylesheet/${name}.html`;
  await page.goto(url("index"));
  await page.waitForFunction(() => !document.querySelector("#friends-nav-item").hidden);
  assert.ok(await page.evaluate(() => sessionStorage.getItem("durak-account-preview")));
  // Theme is applied before any application module can load.
  await page.evaluate(() => localStorage.setItem("durak-theme", "dark"));
  const scripts = [];
  await page.route("**/assets/*.js", (route) => { scripts.push(route); });
  await page.goto(url("rules"), { waitUntil: "commit" });
  await page.waitForFunction(() => document.body?.dataset.theme === "dark");
  await page.unroute("**/assets/*.js");
  await Promise.all(scripts.map((route) => route.continue().catch(() => {})));
  await page.waitForLoadState("load");
  await page.waitForFunction(() => document.body.dataset.theme === "classic");
  // Select a theme before the slow account response, then navigate immediately.
  holdReads = true;
  holdNextWrite = true;
  await page.goto(url("settings"));
  await waitUntil(() => reads.length === 1);
  await page.locator('input[value="DARK"]').check();
  assert.equal(await page.locator("body").getAttribute("data-theme"), "dark");
  await page.goto(url("index"));
  await waitUntil(() => reads.length >= 2);
  assert.equal(await page.locator("#friends-nav-item").isVisible(), true);
  assert.equal(await page.locator("body").getAttribute("data-theme"), "dark");
  releaseReads();
  await waitUntil(() => writes.length === 1);
  // New page chooses LIGHT; the previous page's DARK request is still held.
  holdReads = true;
  await page.goto(url("settings"));
  await waitUntil(() => reads.length === 1);
  for (const theme of ["LIGHT", "CLASSIC", "LIGHT"]) await page.locator(`input[value="${theme}"]`).check();
  releaseReads();
  await page.waitForFunction(() => document.querySelector("#settings-status").textContent === "Tēma saglabāta kontā.");
  assert.equal((await prisma.user.findUnique({ where: { id: userId } })).theme, "LIGHT");
  writes.shift()();
  await waitUntil(() => conflicts === 1);
  assert.equal((await prisma.user.findUnique({ where: { id: userId } })).theme, "LIGHT");
  assert.equal(await page.locator('input[value="LIGHT"]').isChecked(), true);
  // Confirm that navigating does not flash or replace the final choice.
  holdReads = true;
  await page.goto(url("index"));
  await waitUntil(() => reads.length === 1);
  assert.equal(await page.locator("#friends-nav-item").isVisible(), true);
  assert.equal(await page.locator("body").getAttribute("data-theme"), "light");
  releaseReads();
  // A failed write remains usable locally, then is retried on the next page.
  await page.goto(url("settings"));
  await page.route("**/api/auth/theme", (route) => route.fulfill({ status: 503, json: { error: "Test outage" } }));
  await page.locator('input[value="DARK"]').check();
  await page.waitForFunction(() => document.querySelector("#settings-status").dataset.state === "error");
  assert.equal(await page.locator("body").getAttribute("data-theme"), "dark");
  await page.unroute("**/api/auth/theme");
  await page.goto(url("index"));
  await page.waitForFunction(() => localStorage.getItem("durak-theme-pending") === null);
  assert.equal((await prisma.user.findUnique({ where: { id: userId } })).theme, "DARK");
  // The new enum value persists in MySQL and survives page navigation/reload.
  await page.goto(url("settings"));
  await page.locator('input[value="MODERN"]').check();
  await page.waitForFunction(() => document.querySelector("#settings-status").textContent === "Tēma saglabāta kontā.");
  assert.equal((await prisma.user.findUnique({ where: { id: userId } })).theme, "MODERN");
  for (const name of ["index", "auth", "settings"]) {
    await page.goto(url(name));
    await page.waitForFunction(() => document.body.dataset.theme === "modern");
    assert.equal(await page.evaluate(() => localStorage.getItem("durak-theme")), "modern");
  }
  await page.reload();
  assert.equal(await page.locator('input[value="MODERN"]').isChecked(), true);
  // Explicit logout clears the preview; expired sessions also hide protected links.
  await page.goto(url("auth"));
  await page.waitForFunction(() => document.querySelector("#auth-panel").getAttribute("aria-busy") === "false");
  await page.locator("#logout").click();
  await page.waitForFunction(() => !document.querySelector("#login-form").hidden);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("durak-account-preview")), null);
  await page.goto(url("index"));
  assert.equal(await page.locator("#friends-nav-item").isHidden(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: first-paint theme, instant cached Friends navigation, selection before session lookup, rapid changes/navigation, late-write rejection, retry after outage, Modern theme DB persistence/navigation and logout cache cleanup.");
} finally {
  releaseReads();
  writes.forEach((release) => release());
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
