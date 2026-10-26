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
const previous = (g, id) => {
  const i = g.players.findIndex((p) => p.id === id);
  for (let n = 1; n <= g.players.length; n++) {
    const p = g.players[(i - n + g.players.length) % g.players.length];
    if (!p.out) return p.id;
  }
  return null;
};
// Only the defender's two active neighbours participate, attacker first.
const attackers = (g) => [...new Set([g.attacker, next(g, g.defender)])]
  .map((id) => player(g, id))
  .filter((p) => p && !p.out && p.id !== g.defender);
const nextAttacker = (g) => attackers(g).find(
  (p) => !(g.finishedAttackers || []).includes(p.id),
)?.id;
// The clock follows the player whose response is required. Other attackers may
// still finish or throw in while the defender is responding, in their order.
export const actor = (g) =>
  g.result
    ? null
    : g.phase === "defend"
      ? g.defender
      : (nextAttacker(g) ?? g.attacker);

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
    bout: 0,
    finishedAttackers: [],
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
    defenseTargets: {},
    pass: [],
    take: false,
    finish: false,
  };
  const self = player(g, id);
  if (g.result || !self || self.out) return moves;
  const hand = self.hand;
  if (!g.attacks.length) {
    if (id === g.attacker) moves.attack = hand.map((c) => c.id);
    return moves;
  }
  if (id !== g.defender) {
    if (id !== nextAttacker(g)) return moves;
    const ranks = [...g.attacks, ...g.defenses.filter(Boolean)].map(
      (c) => c.rank,
    );
    if (g.attacks.length < g.limit)
      moves.attack = hand
        .filter((c) => ranks.includes(c.rank))
        .map((c) => c.id);
    moves.finish = active(g).length > 2 || g.phase === "taking" || g.defenses.every(Boolean);
    return moves;
  }
  if (g.phase !== "taking") {
    for (const card of hand) {
      const targets = g.attacks
        .filter(
          (a, i) => !g.defenses[i] && canDefend(a, card, g.trumpSuit, g.mode),
        )
        .map((a) => a.id);
      if (targets.length) {
        moves.defend.push(card.id);
        moves.defenseTargets[card.id] = targets;
      }
    }
    moves.take = g.defenses.some((c) => !c);
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
  const losers = g.players
    .filter((p) => p.exitReason === "resign" || p.id === loser)
    .map((p) => p.id);
  g.result = {
    loser,
    losers,
    winners: g.players.filter((p) => !losers.includes(p.id)).map((p) => p.id),
    reason,
  };
  g.phase = "finished";
}
export function advanceClock(g, now = Date.now()) {
  if (g.result) return false;
  const p = player(g, actor(g));
  p.remainingMs = Math.max(0, p.remainingMs - Math.max(0, now - g.updatedAt));
  g.updatedAt = now;
  if (p.remainingMs === 0) {
    finish(g, p.id, "timeout");
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
  const start = g.players.findIndex((p) => p.id === oldAttacker);
  const drawOrder = [...g.players.slice(start), ...g.players.slice(0, start)]
    .filter((p) => !p.out && p.id !== oldDefender)
    .map((p) => p.id);
  if (!player(g, oldDefender).out) drawOrder.push(oldDefender);
  for (const pid of drawOrder) {
    const p = player(g, pid);
    while (p.hand.length < 6 && g.deck.length) p.hand.push(g.deck.pop());
  }
  if (!g.deck.length)
    for (const p of g.players) if (!p.hand.length) p.out = true;
  g.attacks = [];
  g.defenses = [];
  g.limit = 0;
  g.bout = (g.bout ?? 0) + 1;
  g.finishedAttackers = [];
  if (active(g).length <= 1) {
    finish(g, active(g)[0]?.id ?? null, "cards");
    return;
  }
  g.attacker =
    took || player(g, oldDefender).out ? next(g, oldDefender) : oldDefender;
  g.defender = next(g, g.attacker);
  g.phase = "attack";
}

function settleExchange(g) {
  if (g.attacks.length &&
      (g.phase === "taking" || g.defenses.every(Boolean)) &&
      !nextAttacker(g)) exchange(g, g.phase === "taking");
}

function resign(g, id) {
  const self = player(g, id);
  check(!self.out, "Tu jau esi pabeidzis spēli.");
  self.out = true;
  self.exitReason = "resign";
  g.discard.push(...self.hand);
  self.hand = [];
  if (active(g).length <= 1) {
    finish(g, id, "resign");
    return;
  }
  if (!g.attacks.length) {
    if (g.attacker === id) g.attacker = next(g, id);
    g.defender = next(g, g.attacker);
    g.finishedAttackers = [];
  } else if (g.defender === id) {
    // The departing defender's table is discarded; remaining players refill
    // and the next active seat starts. Never give these cards to a new defender.
    exchange(g, false);
    return;
  } else if (g.attacker === id) {
    // Keep the defense in progress, with the new preceding neighbour attacking.
    g.attacker = previous(g, g.defender);
    g.finishedAttackers = [];
  } else {
    g.finishedAttackers = (g.finishedAttackers || []).filter((pid) => pid !== id);
  }
  // Invalidate in-flight actions from before the seating change.
  g.bout = (g.bout ?? 0) + 1;
  settleExchange(g);
}

export function applyMove(state, id, move, now = Date.now()) {
  const g = structuredClone(state);
  check(player(g, id), "Tu neesi šīs spēles dalībnieks.");
  check(!g.result, "Spēle ir beigusies.");
  if (advanceClock(g, now)) return g;
  if (move?.type === "resign") {
    resign(g, id);
    return g;
  }
  if (move?.bout !== undefined)
    check(move.bout === (g.bout ?? 0), "Šī izspēle jau ir beigusies.");
  const legal = legalMoves(g, id),
    type = move?.type;
  check(
    ["attack", "defend", "pass", "take", "finish"].includes(type),
    "Nederīgs gājiens.",
  );
  if (type === "attack") {
    const ids = move.cardIds ?? [move.cardId];
    check(
      Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length <= 6 &&
        new Set(ids).size === ids.length,
      "Izvēlies 1–6 dažādas kārtis.",
    );
    check(
      ids.every((cid) => legal.attack.includes(cid)),
      "Šīs kārtis šobrīd nevar piemest.",
    );
    const hand = player(g, id).hand;
    const cards = ids.map((cid) => hand.find((c) => c.id === cid));
    if (!g.attacks.length) {
      check(
        cards.every((c) => c.rank === cards[0].rank),
        "Pirmajā uzbrukumā kārtīm jābūt ar vienādu vērtību.",
      );
      g.limit = Math.min(6, player(g, g.defender).hand.length);
    }
    check(
      g.attacks.length + cards.length <= g.limit,
      "Sasniegts šīs izspēles kāršu limits.",
    );
    for (const card of cards) {
      hand.splice(
        hand.findIndex((c) => c.id === card.id),
        1,
      );
      g.attacks.push(card);
      g.defenses.push(null);
    }
    if (g.phase !== "taking") g.phase = "defend";
  } else if (type === "defend" || type === "pass") {
    check(legal[type].includes(move.cardId), "Šo kārti šobrīd nevar izspēlēt.");
    const hand = player(g, id).hand;
    if (type === "defend") {
      // Stable card IDs, not indexes: another player can append attacks meanwhile.
      const targetId = move.targetId ?? legal.defenseTargets[move.cardId][0];
      check(
        legal.defenseTargets[move.cardId].includes(targetId),
        "Ar šo kārti nevar nokaut izvēlēto uzbrukumu.",
      );
      const index = g.attacks.findIndex((c) => c.id === targetId);
      g.defenses[index] = hand.splice(
        hand.findIndex((c) => c.id === move.cardId),
        1,
      )[0];
      g.phase = g.defenses.every(Boolean) ? "attack-more" : "defend";
    } else {
      g.attacks.push(
        hand.splice(
          hand.findIndex((c) => c.id === move.cardId),
          1,
        )[0],
      );
      g.defenses.push(null);
      g.attacker = id;
      g.defender = next(g, id);
      g.limit = Math.min(6, player(g, g.defender).hand.length);
      g.finishedAttackers = [];
      g.phase = "defend";
    }
  } else {
    check(legal[type], "Šī darbība pašlaik nav atļauta.");
    if (type === "take") {
      g.phase = "taking";
    } else {
      g.finishedAttackers = [...(g.finishedAttackers || []), id];

    }
  }
  settleExchange(g);
  return g;
}

export function privateView(g, id, version, now = Date.now()) {
  check(player(g, id), "Tu neesi šīs spēles dalībnieks.");
  return {
    version,
    bout: g.bout ?? 0,
    limit: g.limit,
    finishedAttackers: g.finishedAttackers || [],
    attackers: attackers(g).map((p) => p.id),
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
      exitReason: p.exitReason ?? null,
      remainingMs: Math.max(
        0,
        p.remainingMs -
          (actor(g) === p.id ? Math.max(0, now - g.updatedAt) : 0),
      ),
    })),
  };
}
