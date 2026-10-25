import { createDeck, shuffleDeck, canDefend } from "../src/js/game-logic.js";

export class GameError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}
const check = (ok, message) => {
  if (!ok) throw new GameError(message);
};
const player = (g, id) => g.players.find((p) => p.id === id);
const active = (g) => g.players.filter((p) => !p.out);
const next = (g, id) => {
  const i = g.players.findIndex((p) => p.id === id);
  for (let n = 1; n <= g.players.length; n++) {
    const p = g.players[(i + n) % g.players.length];
    if (!p.out) return p.id;
  }
  return null;
};
export const actor = (g) =>
  g.result ? null : g.phase === "defend" ? g.defender : g.attacker;

export function createMultiplayer(
  players,
  mode,
  seconds,
  now = Date.now(),
  random = Math.random,
) {
  check(
    players.length >= 2 && players.length <= 6,
    "Nepieciešami 2–6 spēlētāji.",
  );
  const deck = shuffleDeck(createDeck(), random);
  if (mode === "japan") {
    const i = deck.findIndex((c) => c.suit === "diamonds");
    [deck[0], deck[i]] = [deck[i], deck[0]];
  }
  const trumpCard = deck[0];
  const seats = players.map((p) => ({
    ...p,
    hand: [],
    out: false,
    remainingMs: seconds * 1000,
  }));
  for (let n = 0; n < 6; n++) for (const p of seats) p.hand.push(deck.pop());
  const trumps = seats.flatMap((p) =>
    p.hand
      .filter((c) => c.suit === trumpCard.suit)
      .map((c) => ({ id: p.id, rank: c.rank })),
  );
  trumps.sort((a, b) => a.rank - b.rank);
  const attacker = trumps[0]?.id ?? seats[0].id;
  const g = {
    players: seats,
    mode,
    deck,
    trumpCard,
    trumpSuit: trumpCard.suit,
    discard: [],
    attacker,
    defender: null,
    phase: "attack",
    attacks: [],
    defenses: [],
    limit: 0,
    result: null,
    updatedAt: now,
  };
  g.defender = next(g, attacker);
  return g;
}

export function legalMoves(g, id) {
  const moves = {
    attack: [],
    defend: [],
    pass: [],
    take: false,
    finish: false,
  };
  if (g.result || actor(g) !== id) return moves;
  const hand = player(g, id).hand;
  if (g.phase === "attack") moves.attack = hand.map((c) => c.id);
  if (g.phase === "attack-more") {
    const ranks = [...g.attacks, ...g.defenses.filter(Boolean)].map(
      (c) => c.rank,
    );
    if (g.attacks.length < g.limit)
      moves.attack = hand
        .filter((c) => ranks.includes(c.rank))
        .map((c) => c.id);
    moves.finish = true;
  }
  if (g.phase === "defend") {
    const attack = g.attacks[g.defenses.findIndex((c) => c === null)];
    moves.defend = hand
      .filter((c) => canDefend(attack, c, g.trumpSuit, g.mode))
      .map((c) => c.id);
    moves.take = true;
    const target = player(g, next(g, g.defender));
    if (
      g.mode === "passing" &&
      !g.defenses.some(Boolean) &&
      g.attacks.length < 6 &&
      target.hand.length >= g.attacks.length + 1
    ) {
      moves.pass = hand
        .filter((c) => g.attacks.every((a) => a.rank === c.rank))
        .map((c) => c.id);
    }
  }
  return moves;
}

function finish(g, loser, reason) {
  g.result = {
    loser,
    winners: g.players.filter((p) => p.id !== loser).map((p) => p.id),
    reason,
  };
  g.phase = "finished";
}

function eliminate(g, id, reason) {
  const p = player(g, id);
  check(p, "Tu neesi šīs spēles dalībnieks.");
  check(!p.out, "Tu jau esi pabeidzis spēli.");

  const wasAttacker = g.attacker === id;
  const wasDefender = g.defender === id;

  p.out = true;
  p.hand = [];
  p.remainingMs = 0;

  // clear the table if the player that left was one if the active players
  if (wasAttacker || wasDefender) {
    g.discard.push(
      ...g.attacks,
      ...g.defenses.filter(Boolean),
    );
    g.attacks = [];
    g.defenses = [];
    g.limit = 0;
  }

  const remaining = active(g);

  if (remaining.length <= 1) {
    finish(g, id, reason);
    return;
  }

  // kkep the current active players when possible
  if (wasAttacker || !active(g).some((x) => x.id === g.attacker)) {
    g.attacker = next(g, id);
  }

  if (
    wasDefender ||
    !active(g).some((x) => x.id === g.defender) ||
    g.defender === g.attacker
  ) {
    g.defender = next(g, g.attacker);
  }

  g.phase = "attack";
  g.updatedAt = Date.now();
}

export function advanceClock(g, now = Date.now()) {
  if (g.result) return false;

  const p = player(g, actor(g));
  if (!p) return false;

  p.remainingMs = Math.max(
    0,
    p.remainingMs - Math.max(0, now - g.updatedAt),
  );
  g.updatedAt = now;

  if (p.remainingMs === 0) {
    eliminate(g, p.id, "timeout");
    return true;
  }

  return false;
}

function exchange(g, took) {
  const oldAttacker = g.attacker,
    oldDefender = g.defender;
  const cards = [...g.attacks, ...g.defenses.filter(Boolean)];
  if (took) player(g, oldDefender).hand.push(...cards);
  else g.discard.push(...cards);
  // Refill in seating order, starting with the attacker; defender draws last.
  const drawOrder = [];
  let id = oldAttacker;
  do {
    if (id !== oldDefender) drawOrder.push(id);
    id = next(g, id);
  } while (id !== oldAttacker);
  drawOrder.push(oldDefender);
  for (const pid of drawOrder) {
    const p = player(g, pid);
    while (p.hand.length < 6 && g.deck.length) p.hand.push(g.deck.pop());
  }
  if (!g.deck.length)
    for (const p of g.players) if (!p.hand.length) p.out = true;
  g.attacks = [];
  g.defenses = [];
  g.limit = 0;
  if (active(g).length <= 1) {
    finish(g, active(g)[0]?.id ?? null, "cards");
    return;
  }
  g.attacker =
    took || player(g, oldDefender).out ? next(g, oldDefender) : oldDefender;
  g.defender = next(g, g.attacker);
  g.phase = "attack";
}

export function applyMove(state, id, move, now = Date.now()) {
  const g = structuredClone(state);

  check(player(g, id), "Tu neesi šīs spēles dalībnieks.");
  check(!g.result, "Spēle ir beigusies.");

  // allow players to leave at any time
  if (move?.type === "resign") {
    check(!player(g, id).out, "Tu jau esi pabeidzis spēli.");
    eliminate(g, id, "resign");
    return g;
  }

  if (advanceClock(g, now)) return g;

  check(actor(g) === id, "Pašlaik nav tavs gājiens.");

  const legal = legalMoves(g, id),
    type = move?.type;
  check(
    ["attack", "defend", "pass", "take", "finish"].includes(type),
    "Nederīgs gājiens.",
  );
  if (["attack", "defend", "pass"].includes(type)) {
    check(legal[type].includes(move.cardId), "Šo kārti šobrīd nevar izspēlēt.");
    const hand = player(g, id).hand;
    const [card] = hand.splice(
      hand.findIndex((c) => c.id === move.cardId),
      1,
    );
    if (type === "attack") {
      if (g.phase === "attack")
        g.limit = Math.min(6, player(g, g.defender).hand.length);
      g.attacks.push(card);
      g.defenses.push(null);
      g.phase = "defend";
    } else if (type === "defend") {
      g.defenses[g.defenses.findIndex((c) => c === null)] = card;
      if (g.defenses.every(Boolean)) g.phase = "attack-more";
    } else {
      g.attacks.push(card);
      g.defenses.push(null);
      g.attacker = id;
      g.defender = next(g, id);
      g.limit = Math.min(6, player(g, g.defender).hand.length);
    }
  } else {
    check(legal[type], "Šī darbība pašlaik nav atļauta.");
    exchange(g, type === "take");
  }
  return g;
}

export function privateView(g, id, version, now = Date.now()) {
  check(player(g, id), "Tu neesi šīs spēles dalībnieks.");
  return {
    version,
    selfId: id,
    mode: g.mode,
    phase: g.phase,
    attacker: g.attacker,
    defender: g.defender,
    actor: actor(g),
    trumpCard: g.trumpCard,
    drawCount: g.deck.length,
    attacks: g.attacks,
    defenses: g.defenses,
    result: g.result,
    serverTime: now,
    hand: player(g, id).hand,
    legal: legalMoves(g, id),
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      count: p.hand.length,
      out: p.out,
      remainingMs: Math.max(
        0,
        p.remainingMs -
          (actor(g) === p.id ? Math.max(0, now - g.updatedAt) : 0),
      ),
    })),
  };
}
