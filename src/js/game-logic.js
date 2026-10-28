export const SUITS = ["clubs", "diamonds", "hearts", "spades"];
export const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
export const HAND_SIZE = 6;

export function sortHand(cards, trumpSuit) {
  const suitOrder = new Map(SUITS.map((suit, index) => [suit, index]));
  return [...cards].sort((first, second) =>
    Number(first.suit === trumpSuit) - Number(second.suit === trumpSuit)
    || first.rank - second.rank
    || suitOrder.get(first.suit) - suitOrder.get(second.suit),
  );
}

export function cardImageFilename(rank, suit) {
  const rankName = rank === 11
    ? "jack"
    : rank === 12
      ? "queen"
      : rank === 13
        ? "king"
        : rank === 14
          ? "ace"
          : rank;
  const alternateImageExists = rank === 11 || rank === 12 || rank === 13
    || (rank === 14 && suit === "spades");
  return `${rankName}_of_${suit}${alternateImageExists ? "2" : ""}.png`;
}

export function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: `${rank}_${suit}`,
    rank,
    suit,
    image: cardImageFilename(rank, suit),
  })));
}

export function shuffleDeck(deck, random = Math.random) {
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createGame(random = Math.random, mode = "classic") {
  const deck = shuffleDeck(createDeck(), random);
  const trumpSuit = mode === "japan" ? "diamonds" : SUITS[Math.floor(random() * SUITS.length)];
  const trumpCardIndex = deck.findIndex((card) => card.rank === 14 && card.suit === trumpSuit);
  const [trumpCard] = deck.splice(trumpCardIndex, 1);
  const players = {
    player: { hand: deck.splice(0, HAND_SIZE) },
    bot: { hand: deck.splice(0, HAND_SIZE) },
  };
  deck.unshift(trumpCard);
  const attacker = random() < 0.5 ? "player" : "bot";

  return {
    players,
    drawPile: deck,
    discardPile: [],
    trumpCard,
    trumpSuit,
    mode,
    attacker,
    defender: attacker === "player" ? "bot" : "player",
    phase: "attack",
    attacks: [],
    defenses: [],
    attackLimit: 0,
    result: null,
  };
}

export function canDefend(attackCard, defenseCard, trumpSuit, mode = "classic") {
  if (attackCard.suit === defenseCard.suit) {
    return defenseCard.rank > attackCard.rank;
  }
  if (mode === "japan") {
    return attackCard.suit !== "spades"
      && attackCard.suit !== "diamonds"
      && defenseCard.suit === "diamonds";
  }
  return defenseCard.suit === trumpSuit && attackCard.suit !== trumpSuit;
}

function pendingAttackIndex(game) {
  return game.attacks.findIndex((_, index) => !game.defenses[index]);
}

function tableCards(game) {
  return game.attacks.flatMap((attack, index) => (
    game.defenses[index] ? [attack, game.defenses[index]] : [attack]
  ));
}

export function getLegalDefenses(hand, game) {
  const index = pendingAttackIndex(game);
  if (index === -1) return [];
  return hand.filter((card) => canDefend(game.attacks[index], card, game.trumpSuit, game.mode));
}

export function getLegalAttacks(hand, game) {
  if (game.phase === "attack") return [...hand];
  if (game.phase !== "attack-more" || game.attacks.length >= game.attackLimit) return [];
  const tableRanks = new Set(tableCards(game).map((card) => card.rank));
  return hand.filter((card) => tableRanks.has(card.rank));
}

export function getLegalPasses(hand, game) {
  if (
    game.mode !== "passing"
    || game.phase !== "defend"
    || game.defenses.some(Boolean)
    || pendingAttackIndex(game) === -1
    || game.players[game.attacker].hand.length < game.attacks.length + 1
  ) {
    return [];
  }

  const attackRanks = new Set(game.attacks.map((card) => card.rank));
  const attackSuitsByRank = new Map();
  for (const card of game.attacks) {
    const suits = attackSuitsByRank.get(card.rank) ?? new Set();
    suits.add(card.suit);
    attackSuitsByRank.set(card.rank, suits);
  }

  return hand.filter((card) => (
    attackRanks.has(card.rank)
    && [...(attackSuitsByRank.get(card.rank) ?? [])].some((suit) => suit !== card.suit)
  ));
}

function removeFromHand(hand, cardId) {
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) return null;
  return hand.splice(cardIndex, 1)[0];
}

export function playAttack(game, cardId) {
  if (game.phase !== "attack" || game.result) return false;
  const card = removeFromHand(game.players[game.attacker].hand, cardId);
  if (!card) return false;

  game.attacks = [card];
  game.defenses = [null];
  game.attackLimit = game.players[game.defender].hand.length;
  game.phase = "defend";
  return true;
}

export function addAttack(game, cardId) {
  if (game.phase !== "attack-more" || game.result) return false;
  const card = getLegalAttacks(game.players[game.attacker].hand, game)
    .find((candidate) => candidate.id === cardId);
  if (!card) return false;

  removeFromHand(game.players[game.attacker].hand, cardId);
  game.attacks.push(card);
  game.defenses.push(null);
  game.phase = "defend";
  return true;
}

function drawToHand(game, playerId) {
  const hand = game.players[playerId].hand;
  while (hand.length < HAND_SIZE && game.drawPile.length > 0) {
    hand.push(game.drawPile.pop());
  }
}

function updateResult(game) {
  if (game.drawPile.length > 0) return;
  const [playerCards, botCards] = [
    game.players.player.hand.length,
    game.players.bot.hand.length,
  ];

  if (playerCards === 0 && botCards === 0) {
    game.result = { winner: null, message: "Neizšķirts!" };
  } else if (playerCards === 0 || botCards === 0) {
    const winner = playerCards === 0 ? "player" : "bot";
    game.result = {
      winner,
      message: winner === "player" ? "Tu uzvarēji!" : "Bots uzvarēja!",
    };
  }
}

function finishExchange(game, wasDefended) {
  const oldAttacker = game.attacker;
  const oldDefender = game.defender;
  const cards = tableCards(game);

  if (wasDefended) {
    game.discardPile.push(...cards);
    game.attacker = oldDefender;
    game.defender = oldAttacker;
  } else {
    game.players[oldDefender].hand.push(...cards);
  }

  game.attacks = [];
  game.defenses = [];
  game.attackLimit = 0;
  drawToHand(game, game.attacker);
  drawToHand(game, game.defender);
  updateResult(game);
  game.phase = game.result ? "finished" : "attack";
}

export function playDefense(game, cardId) {
  if (game.phase !== "defend" || game.result) return false;
  const hand = game.players[game.defender].hand;
  const card = getLegalDefenses(hand, game).find((candidate) => candidate.id === cardId);
  if (!card) return false;

  const index = pendingAttackIndex(game);
  game.defenses[index] = removeFromHand(hand, cardId);
  game.phase = pendingAttackIndex(game) === -1 ? "attack-more" : "defend";
  return true;
}

export function passAttack(game, cardId) {
  if (game.phase !== "defend" || game.result) return false;
  const hand = game.players[game.defender].hand;
  const card = getLegalPasses(hand, game).find((candidate) => candidate.id === cardId);
  if (!card) return false;

  removeFromHand(hand, cardId);
  game.attacks.push(card);
  game.defenses.push(null);
  const previousAttacker = game.attacker;
  game.attacker = game.defender;
  game.defender = previousAttacker;
  game.attackLimit = game.players[game.defender].hand.length;
  game.phase = "defend";
  return true;
}

export function takeAttack(game) {
  if (game.phase !== "defend" || game.result || pendingAttackIndex(game) === -1) return false;
  game.phase = "take-reveal";
  return true;
}

export function finishAttack(game) {
  if (game.phase !== "attack-more" || game.result || pendingAttackIndex(game) !== -1) return false;
  finishExchange(game, true);
  return true;
}

export function resolveExchange(game) {
  if (game.phase === "take-reveal") {
    finishExchange(game, false);
    return true;
  }
  return false;
}

export function expireTurnTime(game, loser) {
  if (game.result) return false;
  const winner = loser === "player" ? "bot" : "player";
  game.result = {
    winner,
    message: loser === "player"
      ? "Tavam laikam beidzoties, Bots uzvarēja!"
      : "Botam beidzās laiks! Tu uzvarēji!",
  };
  game.phase = "finished";
  return true;
}

export function chooseRandomCard(cards, random = Math.random) {
  if (cards.length === 0) return null;
  return cards[Math.floor(random() * cards.length)];
}

