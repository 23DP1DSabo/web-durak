import { expect, test } from "vitest";
import { dropMove } from "../src/js/card-drag.js";
const state = {
  hand: [
    { id: "a", rank: 6 },
    { id: "b", rank: 6 },
    { id: "c", rank: 7 },
  ],
  attacks: [],
  players: [{ id: "d", count: 6 }],
  defender: "d",
  legal: { attack: ["a", "b", "c"], pass: ["c"], defenseTargets: { c: ["x"] } },
};
test("drop placement distinguishes defense from passing and ignores outside/illegal drops", () => {
  expect(dropMove(state, ["c"], "defend", "x")).toEqual({
    type: "defend",
    cardId: "c",
    targetId: "x",
  });
  expect(dropMove(state, ["c"], "pass")).toEqual({ type: "pass", cardId: "c" });
  expect(dropMove(state, ["c"], "defend", "y")).toBeNull();
  expect(dropMove(state, ["c"], undefined)).toBeNull();
  expect(dropMove(state, ["a", "b"], "attack").cardIds).toEqual(["a", "b"]);
  expect(dropMove(state, ["a", "c"], "attack")).toBeNull();
  expect(
    dropMove(
      { ...state, players: [{ id: "d", count: 1 }] },
      ["a", "b"],
      "attack",
    ),
  ).toBeNull();
});
