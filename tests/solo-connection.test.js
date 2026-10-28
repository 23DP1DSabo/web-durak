import { afterEach, expect, test, vi } from "vitest";
import { createSoloConnection } from "../src/js/solo-connection.js";
import { sortHand } from "../src/js/game-logic.js";
import { createMultiplayer } from "../lib/multiplayer.js";
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const room = {
  code: "SOLOTEST",
  mode: "classic",
  timeLimitSeconds: 60,
  players: [{ name: "Player" }],
};
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const game = createMultiplayer(
    [
      { id: "player", name: "Player" },
      { id: "bot", name: "Bots" },
    ],
    "classic",
    60,
  );
  game.attacker = "player";
  game.defender = "bot";
  game.trumpSuit = "spades";
  game.players[0].hand = [
    { id: "a", rank: 6, suit: "clubs" },
    { id: "b", rank: 6, suit: "hearts" },
  ];
  game.players[1].hand = [
    { id: "c", rank: 7, suit: "diamonds" },
    { id: "d", rank: 8, suit: "diamonds" },
  ];
  const map = new Map([
    ["durak-solo-v2:SOLOTEST", JSON.stringify({ game, version: 0 })],
  ]);
  const storage = {
    getItem: (key) => map.get(key),
    setItem: (key, value) => map.set(key, value),
  };
  return { game, storage };
}
test("bot declares pickup, waits for player throw-ins and confirmation, and restores the same hand", async () => {
  const { storage } = fixture();
  const connection = createSoloConnection(room, { storage });
  connection.connect();
  let response = await connection.emitWithAck("game:move", {
    version: 0,
    move: { type: "attack", cardId: "a", bout: 0 },
  });
  expect(response.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(800);
  let view = (await connection.emitWithAck("game:join", {})).game;
  expect(view.phase).toBe("taking");
  expect(view.players.find((p) => p.id === "bot").count).toBe(2);
  response = await connection.emitWithAck("game:move", {
    version: view.version,
    move: { type: "attack", cardId: "b", bout: 0 },
  });
  expect(response.game.attacks).toHaveLength(2);
  expect(response.game.legal.finish).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  view = (await connection.emitWithAck("game:join", {})).game;
  expect(view.attacks).toHaveLength(2);
  response = await connection.emitWithAck("game:move", {
    version: view.version, move: { type: "finish", bout: 0 },
  });
  expect(response.game.attacks).toHaveLength(0);
  const hand = response.game.hand;
  connection.disconnect();
  const restored = createSoloConnection(room, { storage });
  restored.connect();
  view = (await restored.emitWithAck("game:join", {})).game;
  expect(view.hand).toEqual(hand);
  expect(view.bout).toBe(1);
  restored.disconnect();
});
test("bot makes its opening move when it starts the game", async () => {
  const { storage } = fixture();
  const saved = JSON.parse(storage.getItem("durak-solo-v2:SOLOTEST"));
  saved.game.attacker = "bot";
  saved.game.defender = "player";
  saved.game.timed = false;
  storage.setItem("durak-solo-v2:SOLOTEST", JSON.stringify(saved));

  const connection = createSoloConnection(
    { ...room, timeLimitSeconds: 0 },
    { storage },
  );
  connection.connect();
  await vi.advanceTimersByTimeAsync(800);

  const view = (await connection.emitWithAck("game:join", {})).game;
  expect(view.timed).toBe(false);
  expect(view.attacker).toBe("bot");
  expect(view.phase).toBe("defend");
  expect(view.attacks).toHaveLength(1);
  expect(view.legal.take).toBe(true);
  connection.disconnect();
});
test("sorted hands keep trumps to the right as cards are added or removed", () => {
  const hand = [
    { id: "trump-high", rank: 14, suit: "hearts" },
    { id: "high", rank: 14, suit: "clubs" },
    { id: "trump-low", rank: 6, suit: "hearts" },
    { id: "middle", rank: 10, suit: "diamonds" },
    { id: "low-spades", rank: 6, suit: "spades" },
    { id: "low-clubs", rank: 6, suit: "clubs" },
  ];
  expect(sortHand(hand, "hearts").map((card) => card.id)).toEqual([
    "low-clubs",
    "low-spades",
    "middle",
    "high",
    "trump-low",
    "trump-high",
  ]);
  expect(sortHand(hand.slice(1, 4), "hearts").map((card) => card.id)).toEqual([
    "middle",
    "high",
    "trump-low",
  ]);
  expect(hand[0].id).toBe("trump-high");
});
test("local timeout reports completion and a restored finished game retries the notification", async () => {
  const { storage } = fixture(),
    onFinish = vi.fn();
  const connection = createSoloConnection(room, { storage, onFinish });
  connection.connect();
  await vi.advanceTimersByTimeAsync(60001);
  expect(onFinish).toHaveBeenCalledTimes(1);
  connection.disconnect();
  const retry = vi.fn(),
    restored = createSoloConnection(room, { storage, onFinish: retry });
  restored.connect();
  const view = (await restored.emitWithAck("game:join", {})).game;
  await Promise.resolve();
  expect(view.result.reason).toBe("inactive");
  expect(retry).toHaveBeenCalledTimes(1);
  restored.disconnect();
});
