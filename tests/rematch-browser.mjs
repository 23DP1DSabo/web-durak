// Real table UI with a deterministic socket snapshot; HTTP leave is intercepted.
import assert from "node:assert/strict";
import { createMultiplayer, privateView } from "../lib/multiplayer.js";
const { chromium } = await import(process.env.DURAK_PLAYWRIGHT_PATH || "playwright");
const vite = await (await import("vite")).createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.DURAK_CHROME_PATH ? { executablePath: process.env.DURAK_CHROME_PATH } : {}),
});
const game = createMultiplayer([1,2,3].map((id) => ({ id: String(id), name: `Player ${id}` })), "classic", 600);
game.result = { loser: "3", losers: ["3"], winners: ["1", "2"], reason: "cards" };
game.phase = "finished";
game.nextRoundReady = ["1", "2"];
try {
  for (const selector of [".game-result-menu-link", "#return-to-room", "@lobby"]) {
    const page = await browser.newPage();
    const errors = [], leaves = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((view) => {
      const handlers = {};
      window.testGameState = (game) => handlers["game:state"]?.(game);
      window.testSocket = {
        connected: true,
        on(event, fn) { handlers[event] = fn; },
        connect() { handlers.connect?.(); },
        disconnect() {},
        timeout() { return { emitWithAck: async () => ({ game: view }) }; },
      };
    }, privateView(game, "3", 10));
    await page.route("**/api/**", (route) => route.fulfill({ json: { user: null } }));
    await page.route("**/api/rooms/TESTROOM/leave", (route) => { leaves.push(route); });
    await page.route("**/src/js/game-entry.js*", (route) => route.fulfill({ contentType: "text/javascript",
      body: 'import { startTable } from "/src/js/multiplayer-table.js"; startTable();',
    }));
    await page.route("**/src/js/multiplayer-table.js*", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const mocked = source.replace(/const socket = localConnection \|\| [^;]+;/, "const socket = window.testSocket;");
      assert.notEqual(source, mocked);
      await route.fulfill({ response, body: mocked });
    });
    await page.goto(`${base}/src/pages%20+%20css%20stylesheet/game-table.html?code=TESTROOM`);
    await page.waitForFunction(() => document.querySelector("#game-result-dialog").open);
    assert.match(await page.locator(".next-round-status").textContent(), /2 \/ 3/);
    if (selector === "@lobby") {
      let joins = 0;
      await page.route("**/api/rooms/NEXTROOM/join", (route) => {
        joins++;
        return route.fulfill({ json: { room: {
          code: "NEXTROOM", mode: "classic", status: "waiting", version: 0,
          selfId: "33", hostId: "22", allowGuests: true, timeLimitSeconds: 600,
          players: [{ id: "22", name: "Player 2", role: "host" }, { id: "33", name: "Player 3", role: "player" }],
        } } });
      });
      const redirectedGame = structuredClone(game);
      redirectedGame.players[0].excludedFromRound = true;
      redirectedGame.nextRoundLobby = { code: "NEXTROOM", members: { "2": "22", "3": "33" } };
      await page.evaluate((view) => window.testGameState(view), privateView(redirectedGame, "3", 11));
      await page.waitForURL("**/room.html?**");
      await page.waitForFunction(() => !document.querySelector(".room-lobby").hidden);
      assert.equal(await page.locator("#room-code").textContent(), "NEXTROOM");
      assert.equal(await page.locator("#player-count").textContent(), "2");
      assert.equal(joins, 1);
      assert.equal(leaves.length, 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log("PASS: rematch decline redirects the remaining player to the shared waiting lobby");
      continue;
    }
    if (selector === "#return-to-room") await page.evaluate(() => document.querySelector("#game-result-dialog").close());
    await page.locator(selector).click();
    await page.waitForURL("**/index.html");
    await page.waitForFunction(() => !document.querySelector("#room-exit-notice").hidden);
    const deadline = Date.now() + 5000;
    while (!leaves.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].request().postDataJSON().membershipId, "3");
    await leaves[0].fulfill({ json: { room: {} } });
    await page.waitForFunction(() => document.querySelector("#room-exit-notice").hidden);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS: ${selector} reports finished-game departure after immediate home navigation`);
  }
} finally {
  await browser.close();
  await vite.close();
}
