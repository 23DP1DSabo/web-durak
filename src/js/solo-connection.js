import {
  createMultiplayer,
  applyMove,
  legalMoves,
  privateView,
  advanceClock,
} from "../../lib/multiplayer.js";

export function chooseBotMove(game) {
  const legal = legalMoves(game, "bot");
  if (legal.pass.length) return { type: "pass", cardId: legal.pass[0] };
  if (legal.defend.length) {
    const cardId = legal.defend[0];
    return {
      type: "defend",
      cardId,
      targetId: legal.defenseTargets[cardId][0],
    };
  }
  if (legal.take) return { type: "take" };
  if (legal.attack.length) return { type: "attack", cardId: legal.attack[0] };
  if (legal.finish) return { type: "finish" };
  return null;
}

// Local bot games use the same rules and table interaction as online matches.
// This adapter implements the small connection interface consumed by the table.
export function createSoloConnection(
  room,
  { storage = window.sessionStorage, onFinish = () => {} } = {},
) {
  const key = `durak-solo-v2:${room.code}`,
    handlers = new Map();
  let game,
    version = 0,
    botTimer = null,
    clockTimer = null,
    notified = false;
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (saved?.game?.players?.some((p) => p.id === "player")) {
      game = saved.game;
      version = saved.version;
    }
  } catch {}
  game ||= createMultiplayer(
    [
      { id: "player", name: room.players[0]?.name || "Spēlētājs" },
      { id: "bot", name: "Bots" },
    ],
    room.mode,
    room.timeLimitSeconds,
  );
  const emit = (event, data) => {
    for (const callback of handlers.get(event) || []) callback(data);
  };
  const snapshot = () => privateView(game, "player", version);
  const save = () => {
    try {
      storage.setItem(key, JSON.stringify({ game, version }));
    } catch {}
  };
  const notifyResult = () => {
    if (game.result && !notified) {
      notified = true;
      Promise.resolve()
        .then(onFinish)
        .catch(() => {
          notified = false;
        });
    }
  };
  const publish = () => {
    save();
    emit("game:state", snapshot());
    notifyResult();
  };
  const schedule = () => {
    if (
      botTimer !== null
      || !connection.connected
      || game.result
      || !chooseBotMove(game)
    ) return;
    botTimer = setTimeout(() => {
      botTimer = null;
      if (!connection.connected || game.result) return;
      const move = chooseBotMove(game);
      if (move) {
        game = applyMove(game, "bot", move);
        version++;
        publish();
      }
      schedule();
    }, 800);
  };
  const connection = {
    connected: false,
    on(event, callback) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(callback);
      return this;
    },
    timeout() {
      return this;
    },
    async emitWithAck(event, data) {
      try {
        if (event === "game:move") {
          if (data.version !== version)
            throw new Error("Galds ir mainījies. Izvēlies kārti vēlreiz.");
          game = applyMove(game, "player", data.move);
          version++;
          publish();
        }
        notifyResult();
        schedule();
        return { game: snapshot() };
      } catch (error) {
        return { error: error.message, status: 409 };
      }
    },
    connect() {
      if (this.connected) return;
      this.connected = true;
      if (advanceClock(game)) {
        version++;
        publish();
      }
      emit("connect");
      schedule();
      clockTimer = setInterval(() => {
        if (!game.result && advanceClock(game)) {
          version++;
          publish();
          clearTimeout(botTimer);
          botTimer = null;
        } else {
          schedule();
        }
      }, 250);
    },
    disconnect() {
      this.connected = false;
      clearTimeout(botTimer);
      botTimer = null;
      clearInterval(clockTimer);
      save();
      emit("disconnect");
    },
  };
  return connection;
}
