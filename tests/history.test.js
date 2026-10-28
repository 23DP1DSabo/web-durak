import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAuthApp } from "../app.js";
import { archiveRound } from "../lib/history.js";
let server, base, db;
const cookie = "durak_session=" + "a".repeat(64);
beforeEach(async () => {
  db = {
    session: { findUnique: vi.fn(async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: 7n, status: "ACTIVE" } })) },
    roundPlayer: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
  };
  server = createAuthApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/me`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });
const get = (path, authenticated = true) => fetch(base + path, { headers: authenticated ? { cookie } : {} });
test("history and statistics require authentication", async () => {
  for (const path of ["/history", "/statistics"]) expect((await get(path, false)).status).toBe(401);
  expect(db.roundPlayer.findMany).not.toHaveBeenCalled();
  expect(db.roundPlayer.groupBy).not.toHaveBeenCalled();
});
test("statistics are scoped to the session and include draws in win rate", async () => {
  db.roundPlayer.groupBy.mockResolvedValue([ { result: "WIN", _count: { _all: 2 } }, { result: "DURAK", _count: { _all: 1 } }, { result: "DRAW", _count: { _all: 1 } } ]);
  expect(await (await get("/statistics?userId=99")).json()).toEqual({ statistics: { total: 4, wins: 2, losses: 1, draws: 1, winRate: 50 } });
  expect(db.roundPlayer.groupBy.mock.calls[0][0].where).toEqual({ userId: 7n });
});
test("empty statistics return zero rather than NaN", async () => {
  expect((await (await get("/statistics")).json()).statistics).toEqual({ total: 0, wins: 0, losses: 0, draws: 0, winRate: 0 });
});
test("history pages expose only display fields and never another user's records", async () => {
  const round = { mode: "classic", startedAt: new Date(1000), endedAt: new Date(61000), reason: "resign", players: [
    { id: 99n, guestName: null, result: "WIN", user: { username: "Player" } },
    { id: 100n, guestName: "Guest", result: "DURAK", user: null },
    { id: 101n, guestName: null, result: "WIN", user: null },
  ] };
  db.roundPlayer.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: BigInt(99 - i), result: "WIN", round })));
  const response = await get("/history?before=120&userId=99");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const data = await response.json();
  expect(data.games).toHaveLength(20); expect(data.nextCursor).toBe("80");
  expect(data.games[0].durationSeconds).toBe(60);
  expect(data.games[0].players).toEqual([
    { name: "Player", result: "WIN", isSelf: true }, { name: "Guest", result: "DURAK", isSelf: false }, { name: "Dzēsts lietotājs", result: "WIN", isSelf: false },
  ]);
  const query = db.roundPlayer.findMany.mock.calls[0][0];
  expect(query.where).toEqual({ userId: 7n, id: { lt: 120n } }); expect(query.take).toBe(21);
  expect(query.select.round.select.players.select.user).toEqual({ select: { username: true } });
});
test.each(["-1", "0", "nope", "9223372036854775808", "1&before=2"])("rejects invalid history cursor %s", async (cursor) => {
  expect((await get("/history?before=" + cursor)).status).toBe(400);
  expect(db.roundPlayer.findMany).not.toHaveBeenCalled();
});
test("archive includes earlier resignations and records draws without inventing winners", async () => {
  const upsert = vi.fn();
  const room = { id: 1n, mode: "passing", startedAt: new Date(0), players: [
    { id: 1n, userId: 7n }, { id: 2n, userId: 8n }, { id: 3n, userId: null, guestName: "Guest" },
  ] };
  await archiveRound({ matchRound: { upsert } }, room, { players: [{ id: "1" }, { id: "2" }, { id: "3" }], result: { losers: ["1", "3"], reason: "cards" } }, new Date());
  expect(upsert.mock.calls[0][0].create.players.create.map(p => p.result)).toEqual(["DURAK", "WIN", "DURAK"]);
  await archiveRound({ matchRound: { upsert } }, room, { players: [{ id: "1" }, { id: "2" }], result: { loser: null, losers: [], reason: "cards" } }, new Date());
  expect(upsert.mock.calls[1][0].create.players.create.map(p => p.result)).toEqual(["DRAW", "DRAW"]);
});
