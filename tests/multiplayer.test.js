import { expect, test } from "vitest";
import {
  createMultiplayer,
  applyMove,
  actor,
  legalMoves,
  privateView,
  advanceClock,
} from "../lib/multiplayer.js";
const seats = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Player ${i + 1}`,
  }));
function rng(seed = 123) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const cards = (g) => [
  ...g.deck,
  ...g.discard,
  ...g.attacks,
  ...g.defenses.filter(Boolean),
  ...g.players.flatMap((p) => p.hand),
];

test("deals one shared deck to 2?6 players without leaking hidden cards", () => {
  for (let n = 2; n <= 6; n++) {
    const g = createMultiplayer(seats(n), "classic", 600, 0, rng());
    expect(cards(g)).toHaveLength(36);
    expect(new Set(cards(g).map((c) => c.id)).size).toBe(36);
    expect(g.players.every((p) => p.hand.length === 6)).toBe(true);
    const view = privateView(g, "1", 1, 0);
    expect(view.hand).toEqual(g.players[0].hand);
    expect(view.deck).toBeUndefined();
    expect(view.players.every((p) => p.hand === undefined)).toBe(true);
  }
});
test("rejects another player's turn, forged card and unsupported action without changing state", () => {
  const g = createMultiplayer(seats(3), "classic", 60, 0, rng());
  const before = structuredClone(g);
  const other = g.players.find((p) => p.id !== actor(g));
  expect(() =>
    applyMove(g, other.id, { type: "attack", cardId: other.hand[0].id }, 100),
  ).toThrow();
  expect(() =>
    applyMove(g, actor(g), { type: "attack", cardId: "forged" }, 100),
  ).toThrow();
  expect(() => applyMove(g, actor(g), { type: "finish" }, 100)).toThrow();
  expect(g).toEqual(before);
});
test("server clock expires even without client actions and survives serialized state", () => {
  const g = createMultiplayer(seats(2), "classic", 60, 1000, rng());
  const loser = actor(g);
  const restored = JSON.parse(JSON.stringify(g));
  expect(advanceClock(restored, 61000)).toBe(true);
  expect(restored.result).toMatchObject({ loser, reason: "timeout" });
  expect(() => applyMove(restored, loser, { type: "attack" }, 62000)).toThrow();
});
test("passing transfers defense to the next seat and checks that seat's capacity", () => {
  const g = createMultiplayer(seats(3), "passing", 60, 0, rng());
  g.attacker = "1";
  g.defender = "2";
  g.phase = "defend";
  g.attacks = [{ id: "a", rank: 7, suit: "clubs" }];
  g.defenses = [null];
  g.players[1].hand = [{ id: "b", rank: 7, suit: "hearts" }];
  g.players[2].hand = [
    { id: "c", rank: 8, suit: "clubs" },
    { id: "d", rank: 9, suit: "clubs" },
  ];
  expect(legalMoves(g, "2").pass).toEqual(["b"]);
  const next = applyMove(g, "2", { type: "pass", cardId: "b" }, 0);
  expect(next.defender).toBe("3");
  expect(next.attacker).toBe("2");
  g.players[2].hand.pop();
  expect(legalMoves(g, "2").pass).toEqual([]);
});
test("complete 2-, 3- and 6-player matches conserve cards and rotate seats", () => {
  for (const n of [2, 3, 6])
    for (const mode of ["classic", "passing", "japan"]) {
      let g = createMultiplayer(seats(n), mode, 600, 0, rng(n * 17));
      for (let i = 0; !g.result && i < 10000; i++) {
        const id = actor(g),
          l = legalMoves(g, id);
        const move = l.defend.length
          ? { type: "defend", cardId: l.defend[0] }
          : l.pass.length
            ? { type: "pass", cardId: l.pass[0] }
            : l.take
              ? { type: "take" }
              : l.attack.length
                ? { type: "attack", cardId: l.attack[0] }
                : { type: "finish" };
        g = applyMove(g, id, move, 0);
        expect(cards(g)).toHaveLength(36);
        expect(new Set(cards(g).map((c) => c.id)).size).toBe(36);
      }
      expect(g.result).not.toBeNull();
      expect(g.phase).toBe("finished");
    }
});
