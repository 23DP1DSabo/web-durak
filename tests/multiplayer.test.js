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

const card = (rank, suit = "clubs") => ({ id: `${rank}-${suit}`, rank, suit });
function scenario(n = 2, mode = "classic") {
  const g = createMultiplayer(seats(n), mode, 600, 0, rng());
  g.attacker = "1";
  g.defender = "2";
  g.trumpSuit = "spades";
  g.players[0].hand = [
    card(6),
    card(6, "hearts"),
    card(6, "diamonds"),
    card(7),
    card(8),
    card(9),
  ];
  g.players[1].hand = [
    card(7, "hearts"),
    card(8, "hearts"),
    card(7, "spades"),
    card(8, "spades"),
    card(10, "spades"),
    card(11, "spades"),
  ];
  return g;
}
const play = (g, id, move) => applyMove(g, id, move, 0);

test("attacker can lay several cards atomically and add cards while defense is pending", () => {
  let g = scenario();
  g = play(g, "1", { type: "attack", cardIds: ["6-clubs", "6-hearts"] });
  expect(g.attacks).toHaveLength(2);
  expect(legalMoves(g, "1").attack).toContain("6-diamonds");
  expect(legalMoves(g, "2").defend).toContain("7-hearts");
  g = play(g, "1", { type: "attack", cardId: "6-diamonds" });
  expect(g.attacks).toHaveLength(3);
  expect(g.phase).toBe("defend");
});

test("defender can cover any compatible attack, never an incompatible or covered target", () => {
  let g = play(scenario(), "1", {
    type: "attack",
    cardIds: ["6-clubs", "6-hearts"],
  });
  expect(() =>
    play(g, "2", { type: "defend", cardId: "7-hearts", targetId: "6-clubs" }),
  ).toThrow();
  g = play(g, "2", {
    type: "defend",
    cardId: "7-hearts",
    targetId: "6-hearts",
  });
  expect(g.defenses[0]).toBeNull();
  expect(g.defenses[1].id).toBe("7-hearts");
  expect(legalMoves(g, "1").attack).toContain("7-clubs");
  expect(() =>
    play(g, "2", { type: "defend", cardId: "8-hearts", targetId: "6-hearts" }),
  ).toThrow();
});

test("attack batches reject mixed initial ranks, duplicates, forged cards and capacity overflow atomically", () => {
  const g = scenario(),
    before = structuredClone(g);
  for (const ids of [
    ["6-clubs", "7-clubs"],
    ["6-clubs", "6-clubs"],
    ["6-clubs", "forged"],
  ])
    expect(() => play(g, "1", { type: "attack", cardIds: ids })).toThrow();
  expect(g).toEqual(before);
  g.players[1].hand.length = 1;
  expect(() =>
    play(g, "1", { type: "attack", cardIds: ["6-clubs", "6-hearts"] }),
  ).toThrow();
});

test("taking waits for throw-ins and confirmation, retains cards until then and caps at six", () => {
  let g = scenario();
  g.players[0].hand = [
    card(6),
    card(6, "hearts"),
    card(6, "diamonds"),
    card(7),
    card(7, "diamonds"),
    card(7, "spades"),
    card(8),
  ];
  g = play(g, "1", {
    type: "attack",
    cardIds: ["6-clubs", "6-hearts", "6-diamonds"],
  });
  g = play(g, "2", {
    type: "defend",
    cardId: "7-hearts",
    targetId: "6-hearts",
  });
  const count = g.players[1].hand.length;
  g = play(g, "2", { type: "take" });
  expect(g.phase).toBe("taking");
  expect(g.players[1].hand).toHaveLength(count);
  expect(legalMoves(g, "2").defend).toEqual([]);
  expect(() => play(g, "2", { type: "finish" })).toThrow();
  g = play(g, "1", {
    type: "attack",
    cardIds: ["7-clubs", "7-diamonds", "7-spades"],
  });
  expect(g.attacks).toHaveLength(6);
  expect(legalMoves(g, "1").attack).toEqual([]);
  g = play(g, "1", { type: "finish" });
  expect(g.players[1].hand).toHaveLength(count + 7);
  expect(g.attacks).toEqual([]);
  expect(g.attacker).toBe("1");
  expect(g.bout).toBe(1);
});

test("the next neighbour throws in after the attacker finishes without reopening that attacker", () => {
  let g = scenario(3);
  g.players[2].hand = [card(6, "spades"), card(10)];
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "2", { type: "take" });
  g = play(g, "1", { type: "finish" });
  expect(g.phase).toBe("taking");
  g = play(g, "3", { type: "attack", cardId: "6-spades" });
  expect(g.finishedAttackers).toEqual(["1"]);
  expect(legalMoves(g, "1").attack).toEqual([]);
  g = play(g, "3", { type: "finish" });
  expect(g.phase).toBe("attack");
  expect(g.attacker).toBe("3");
});

test("transfer accepts matching rank before defense, respects six cards and blocks after a cover or take", () => {
  let g = scenario(3, "passing");
  g.players[1].hand.push(card(6, "spades"));
  g = play(g, "1", { type: "attack", cardIds: ["6-clubs", "6-hearts"] });
  const transferred = play(g, "2", { type: "pass", cardId: "6-spades" });
  expect(transferred.defender).toBe("3");
  expect(transferred.attacks).toHaveLength(3);
  expect(legalMoves(play(g, "2", { type: "take" }), "2").pass).toEqual([]);
  g = play(g, "2", {
    type: "defend",
    cardId: "7-hearts",
    targetId: "6-hearts",
  });
  expect(legalMoves(g, "2").pass).toEqual([]);
});

test("restored taking state keeps confirmations and times the remaining attacker", () => {
  let g = play(scenario(3), "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "2", { type: "take" });
  g = play(g, "1", { type: "finish" });
  const restored = JSON.parse(JSON.stringify(g));
  expect(actor(restored)).toBe("3");
  expect(advanceClock(restored, 600001)).toBe(true);
  expect(restored.result.loser).toBe("3");
});


test.each([3, 4, 5, 6])("only adjacent players can throw in, attacker first (%i players)", (n) => {
  let g = scenario(n);
  g.players[2].hand = [card(6, "spades"), card(10)];
  if (n > 3) g.players[3].hand = [card(6, "diamonds"), card(11)];
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  expect(legalMoves(g, "3").attack).toEqual([]);
  expect(legalMoves(g, "3").finish).toBe(false);
  expect(() => play(g, "3", { type: "attack", cardId: "6-spades" })).toThrow();
  g = play(g, "1", { type: "finish" });
  expect(g.phase).toBe("defend");
  expect(legalMoves(g, "3").attack).toEqual(["6-spades"]);
  expect(legalMoves(g, "1").attack).toEqual([]);
  if (n > 3) {
    expect(legalMoves(g, "4").attack).toEqual([]);
    expect(legalMoves(g, "4").finish).toBe(false);
    expect(() => play(g, "4", { type: "attack", cardId: "6-diamonds" })).toThrow();
  }
  g = play(g, "3", { type: "attack", cardId: "6-spades" });
  g = play(g, "2", { type: "take" });
  expect(g.finishedAttackers).toEqual(["1"]);
  g = play(g, "3", { type: "finish" });
  expect(g.bout).toBe(1);
  expect(g.attacker).toBe("3");
  expect(g.defender).toBe(n === 3 ? "1" : "4");
});

test("both neighbours can finish while defense is pending; last defense rotates the turn", () => {
  let g = scenario(4);
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "1", { type: "finish" });
  g = play(g, "3", { type: "finish" });
  expect(g.bout).toBe(0);
  expect(actor(g)).toBe("2");
  g = play(g, "2", { type: "defend", cardId: "7-spades", targetId: "6-clubs" });
  expect(g.bout).toBe(1);
  expect(g.attacker).toBe("2");
  expect(g.defender).toBe("3");
});

test("neighbours wrap around the table and skip players already out", () => {
  let g = scenario(5);
  g.attacker = "5";
  g.defender = "1";
  g.players[4].hand = [card(6, "spades"), card(10)];
  g.players[1].out = true;
  g.players[2].hand = [card(6, "hearts"), card(11)];
  g = play(g, "5", { type: "attack", cardId: "6-spades" });
  expect(privateView(g, "1", 1, 0).attackers).toEqual(["5", "3"]);
  g = play(g, "5", { type: "finish" });
  expect(legalMoves(g, "3").attack).toContain("6-hearts");
  expect(legalMoves(g, "2").attack).toEqual([]);
  expect(legalMoves(g, "4").finish).toBe(false);
});

test("passing changes both neighbours and gives the new attacker first rights", () => {
  let g = scenario(4, "passing");
  g.players[1].hand.push(card(6, "spades"));
  g.players[3].hand = [card(6, "hearts"), card(10)];
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "1", { type: "finish" });
  g = play(g, "2", { type: "pass", cardId: "6-spades" });
  expect(privateView(g, "1", 1, 0).attackers).toEqual(["2", "4"]);
  expect(g.finishedAttackers).toEqual([]);
  expect(legalMoves(g, "1").attack).toEqual([]);
  expect(legalMoves(g, "4").attack).toEqual([]);
  g = play(g, "2", { type: "finish" });
  expect(legalMoves(g, "4").attack).toContain("6-hearts");
});

function automatedMove(g) {
  const id = actor(g), legal = legalMoves(g, id);
  const move = legal.defend.length ? { type: "defend", cardId: legal.defend[0] }
    : legal.take ? { type: "take" }
    : legal.attack.length ? { type: "attack", cardId: legal.attack[0] }
    : { type: "finish" };
  return play(g, id, move);
}

test.each(["attack", "defend", "taking"])("any seat can resign during %s without ending a four-player game", (phase) => {
  for (const id of ["1", "2", "3", "4"]) {
    let g = createMultiplayer(seats(4), "classic", 600, 0, rng());
    g.attacker = "1";
    g.defender = "2";
    if (phase !== "attack") g = play(g, "1", { type: "attack", cardId: g.players[0].hand[0].id });
    if (phase === "taking") g = play(g, "2", { type: "take" });
    const before = structuredClone(g);
    g = play(g, id, { type: "resign" });
    expect(before.players.find((p) => p.id === id).out).toBe(false);
    expect(g.result).toBeNull();
    expect(g.players.find((p) => p.id === id)).toMatchObject({ out: true, exitReason: "resign", hand: [] });
    expect(g.attacker).not.toBe(id);
    expect(g.defender).not.toBe(id);
    expect(legalMoves(g, id)).toMatchObject({ attack: [], defend: [], take: false, finish: false });
    expect(() => play(g, id, { type: "resign" })).toThrow();
    expect(cards(g)).toHaveLength(36);
    expect(new Set(cards(g).map((c) => c.id)).size).toBe(36);
    for (let i = 0; !g.result && i < 10000; i++) g = automatedMove(g);
    expect(g.result).not.toBeNull();
    expect(g.result.winners).not.toContain(id);
    expect(g.result.losers).toContain(id);
    expect(cards(g)).toHaveLength(36);
  }
});

test("three players continue as two; a second resignation ends the game with both forfeits recorded", () => {
  let g = createMultiplayer(seats(3), "classic", 600, 0, rng());
  g = play(g, "3", { type: "resign" });
  expect(g.result).toBeNull();
  expect(g.players.filter((p) => !p.out)).toHaveLength(2);
  g = JSON.parse(JSON.stringify(g));
  g = play(g, "2", { type: "resign" });
  expect(g.result).toMatchObject({ loser: "2", losers: ["2", "3"], winners: ["1"], reason: "resign" });
});

test("a resigned defender's table is discarded and the next active seat attacks", () => {
  let g = createMultiplayer(seats(3), "classic", 600, 0, rng());
  g.attacker = "1";
  g.defender = "2";
  const cardId = g.players[0].hand[0].id;
  g = play(g, "1", { type: "attack", cardId });
  g = play(g, "2", { type: "resign" });
  expect(g.result).toBeNull();
  expect(g.discard.map((c) => c.id)).toContain(cardId);
  expect(g.attacks).toEqual([]);
  expect(g.attacker).toBe("3");
  expect(g.defender).toBe("1");
  expect(g.players[0].hand).toHaveLength(6);
});
