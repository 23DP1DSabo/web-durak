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
  g.players.find((p) => p.id === loser).movesMade = 1;
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
        g = applyMove(g, id, move, g.updatedAt);
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
const play = (g, id, move) => applyMove(g, id, move, g.updatedAt);

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
  expect(g.settleAt).toBeNull();
  expect(legalMoves(g, "1").finish).toBe(true);
  expect(advanceClock(g, 5000)).toBe(false);
  expect(g.attacks).toHaveLength(6);
  g = play(g, "1", { type: "finish" });
  expect(g.players[1].hand).toHaveLength(count + 7);
  expect(g.attacks).toEqual([]);
  expect(g.attacker).toBe("1");
  expect(g.bout).toBe(1);
});

test("both neighbours can keep throwing after the primary attacker opens participation", () => {
  let g = scenario(3);
  g.players[2].hand = [card(6, "spades"), card(10)];
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "2", { type: "take" });
  g = play(g, "1", { type: "finish" });
  expect(g.phase).toBe("taking");
  g = play(g, "3", { type: "attack", cardId: "6-spades" });
  expect(g.finishedAttackers).toEqual([]);
  expect(legalMoves(g, "1").attack).toContain("6-hearts");
  g = play(g, "3", { type: "finish" });
  expect(g.bout).toBe(0);
  g = play(g, "1", { type: "finish" });
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
  g.players[2].movesMade = 1;
  const restored = JSON.parse(JSON.stringify(g));
  expect(actor(restored)).toBe("3");
  expect(advanceClock(restored, 600001)).toBe(true);
  expect(restored.result).toBeNull();
  expect(restored.players[2]).toMatchObject({ out: true, exitReason: "timeout", remainingMs: 0 });
  expect(restored.phase).toBe("attack");
  expect(actor(restored)).toBe("1");
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
  expect(legalMoves(g, "1").attack).toContain("6-hearts");
  if (n > 3) {
    expect(legalMoves(g, "4").attack).toEqual([]);
    expect(legalMoves(g, "4").finish).toBe(false);
    expect(() => play(g, "4", { type: "attack", cardId: "6-diamonds" })).toThrow();
  }
  g = play(g, "3", { type: "attack", cardId: "6-spades" });
  g = play(g, "2", { type: "take" });
  expect(g.finishedAttackers).toEqual([]);
  g = play(g, "3", { type: "finish" });
  g = play(g, "1", { type: "finish" });
  expect(g.bout).toBe(1);
  expect(g.attacker).toBe("3");
  expect(g.defender).toBe(n === 3 ? "1" : "4");
});

test("after defense both neighbours must confirm the current table", () => {
  let g = scenario(4);
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "1", { type: "finish" });
  expect(legalMoves(g, "3").finish).toBe(false);
  expect(g.bout).toBe(0);
  expect(actor(g)).toBe("2");
  g = play(g, "2", { type: "defend", cardId: "7-spades", targetId: "6-clubs" });
  expect(legalMoves(g, "1").finish).toBe(true);
  expect(legalMoves(g, "3").finish).toBe(true);
  g = play(g, "3", { type: "finish" });
  g = play(g, "1", { type: "finish" });
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


test.each(["attack", "defend", "taking"])("timeout during %s removes only that player and conserves cards", (phase) => {
  let g = createMultiplayer(seats(4), "classic", 600, 0, rng());
  g.attacker = "1";
  g.defender = "2";
  if (phase !== "attack") g = play(g, "1", { type: "attack", cardId: g.players[0].hand[0].id });
  if (phase === "taking") g = play(g, "2", { type: "take" });
  const expired = actor(g);
  g.players.find((p) => p.id === expired).movesMade = 1;
  expect(advanceClock(g, 600001)).toBe(true);
  expect(g.result).toBeNull();
  expect(g.players.find((p) => p.id === expired)).toMatchObject({ out: true, exitReason: "timeout", hand: [], remainingMs: 0 });
  expect(g.players.filter((p) => !p.out).every((p) => p.remainingMs === 600000)).toBe(true);
  expect(cards(g)).toHaveLength(36);
  expect(new Set(cards(g).map((c) => c.id)).size).toBe(36);
  expect(actor(g)).not.toBe(expired);
  expect(advanceClock(g, 600001)).toBe(false);
  for (let i = 0; !g.result && i < 10000; i++) g = automatedMove(g);
  expect(g.result).not.toBeNull();
  expect(g.result.losers).toContain(expired);
  expect(g.result.winners).not.toContain(expired);
});

test("resignation charges elapsed time once before changing the active clock", () => {
  let g = createMultiplayer(seats(3), "classic", 600, 0, rng());
  g.attacker = "1";
  g.defender = "2";
  g = applyMove(g, "3", { type: "resign" }, 10000);
  expect(g.players[0].remainingMs).toBe(590000);
  expect(g.players[1].remainingMs).toBe(600000);
  expect(g.updatedAt).toBe(10000);
  expect(advanceClock(g, 11000)).toBe(false);
  expect(g.players[0].remainingMs).toBe(589000);
});


test("new throw-ins reopen both approvals after defense or pickup, without closing participation", () => {
  let g = scenario(3);
  g.players[2].hand = [card(6, "spades"), card(7, "diamonds")];
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "1", { type: "finish" });
  g = play(g, "2", { type: "defend", cardId: "7-spades", targetId: "6-clubs" });
  g = play(g, "3", { type: "finish" });
  expect(legalMoves(g, "3").finish).toBe(false);
  expect(legalMoves(g, "3").attack).toContain("6-spades");
  g = play(g, "1", { type: "attack", cardId: "6-hearts" });
  expect(g.finishedAttackers).toEqual([]);
  expect(g.throwInsOpen).toBe(true);
  expect(legalMoves(g, "3").finish).toBe(false);
  g = play(g, "2", { type: "defend", cardId: "7-hearts", targetId: "6-hearts" });
  expect(legalMoves(g, "1").finish).toBe(true);
  expect(legalMoves(g, "3").finish).toBe(true);
  g = play(g, "1", { type: "finish" });
  g = play(g, "3", { type: "attack", cardId: "7-diamonds" });
  g = play(g, "2", { type: "take" });
  expect(g.finishedAttackers).toEqual([]);
  g = play(g, "3", { type: "finish" });
  expect(g.bout).toBe(0);
  g = play(g, "1", { type: "finish" });
  expect(g.bout).toBe(1);
  expect(g.throwInsOpen).toBe(false);
});

test.each([2, 3, 6])("limit waits for all attacker approvals with %i players", (n) => {
  for (const limit of [2, 6]) for (const taking of [false, true]) {
    let g = scenario(n);
    g.limit = limit;
    g.phase = "defend";
    g.attacks = [card(6), card(6, "hearts"), card(6, "diamonds"), card(6, "spades"), card(7), card(7, "diamonds")].slice(0, limit);
    g.defenses = Array(limit).fill(null);
    g.players[1].hand = [8, 9, 10, 11, 12, 13].map((rank) => card(rank, "spades")).slice(0, limit);
    if (taking) g = applyMove(g, "2", { type: "take" }, 100);
    else {
      for (let i = 0; i < limit; i++) {
        expect(g.settleAt).toBeNull();
        g = applyMove(g, "2", { type: "defend", cardId: `${8+i}-spades`, targetId: g.attacks[i].id }, 100);
      }
    }
    expect(g.settleAt).toBeNull();
    expect(g.attacks).toHaveLength(limit);
    expect(legalMoves(g, "1").finish).toBe(true);
    expect(legalMoves(g, "2").finish).toBe(false);
    if (n > 2) expect(legalMoves(g, "3").finish).toBe(true);
    let restored = JSON.parse(JSON.stringify(g));
    expect(advanceClock(restored, 10100)).toBe(false);
    expect(restored.attacks).toHaveLength(limit);
    restored = play(restored, "1", { type: "finish" });
    if (n > 2) {
      expect(restored.bout).toBe(0);
      expect(restored.attacks).toHaveLength(limit);
      expect(legalMoves(restored, "1").finish).toBe(false);
      restored = play(restored, "3", { type: "finish" });
    }
    expect(restored.bout).toBe(1);
    expect(restored.attacks).toEqual([]);
    expect(restored.settleAt).toBeNull();
  }
});

test("attack capacity is fixed at the defender's starting hand, not their remaining hand", () => {
  let g = scenario(3);
  g.players[1].hand = [card(7, "spades"), card(8, "spades")];
  g = play(g, "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "2", { type: "defend", cardId: "7-spades", targetId: "6-clubs" });
  expect(g.limit).toBe(2);
  expect(g.settleAt).toBeNull();
  g = play(g, "1", { type: "attack", cardId: "6-hearts" });
  g = play(g, "2", { type: "defend", cardId: "8-spades", targetId: "6-hearts" });
  expect(g.limit).toBe(2);
  expect(g.settleAt).toBeNull();
  expect(legalMoves(g, "1").finish).toBe(true);
  expect(legalMoves(g, "3").finish).toBe(true);
});

test("an untouched player's clock still expires as inactivity", () => {
  const g = createMultiplayer(seats(2), "classic", 60, 0, rng());
  expect(advanceClock(g, 60000)).toBe(true);
  expect(g.result.reason).toBe("inactive");
});


test("a stored automatic pause becomes manual confirmation without losing the table", () => {
  let g = play(scenario(3), "1", { type: "attack", cardId: "6-clubs" });
  g = play(g, "2", { type: "take" });
  g.settleAt = 2000;
  const before = g.attacks;
  const restored = JSON.parse(JSON.stringify(g));
  expect(advanceClock(restored, 1000000)).toBe(true);
  expect(restored.settleAt).toBeNull();
  expect(restored.attacks).toEqual(before);
  expect(restored.result).toBeNull();
  expect(restored.bout).toBe(0);
  expect(legalMoves(restored, "1").finish).toBe(true);
  expect(legalMoves(restored, "3").finish).toBe(true);
  const clicked = applyMove(g, "1", { type: "finish" }, 1000000);
  expect(clicked.finishedAttackers).toEqual(["1"]);
  expect(clicked.bout).toBe(0);
});
