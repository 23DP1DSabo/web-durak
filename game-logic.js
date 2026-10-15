export const SUITS = ["clubs", "diamonds", "hearts", "spades"];
export const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
export const HAND_SIZE = 6;

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

export function createGame(random = Math.random) {
  const deck = shuffleDeck(createDeck(), random);
  const trumpSuit = SUITS[Math.floor(random() * SUITS.length)];
  const players = {
    player: { hand: deck.splice(0, HAND_SIZE) },
    bot: { hand: deck.splice(0, HAND_SIZE) },
  };
  const attacker = random() < 0.5 ? "player" : "bot";

  return {
    players,
    drawPile: deck,
    discardPile: [],
    trumpSuit,
    attacker,
    defender: attacker === "player" ? "bot" : "player",
    phase: "attack",
    attackCard: null,
    defenseCard: null,
    result: null,
  };
}

export function canDefend(attackCard, defenseCard, trumpSuit) {
  if (attackCard.suit === defenseCard.suit) {
    return defenseCard.rank > attackCard.rank;
  }
  return defenseCard.suit === trumpSuit && attackCard.suit !== trumpSuit;
}

export function getLegalDefenses(hand, attackCard, trumpSuit) {
  return hand.filter((card) => canDefend(attackCard, card, trumpSuit));
}

export function playAttack(game, cardId) {
  if (game.phase !== "attack" || game.result) return false;
  const hand = game.players[game.attacker].hand;
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) return false;

  [game.attackCard] = hand.splice(cardIndex, 1);
  game.defenseCard = null;
  game.phase = "defend";
  return true;
}

function drawToHand(game, playerId) {
  const hand = game.players[playerId].hand;
  while (hand.length < HAND_SIZE && game.drawPile.length > 0) {
    hand.push(game.drawPile.pop());
  }
}

function finishExchange(game, wasDefended) {
  const oldAttacker = game.attacker;
  const oldDefender = game.defender;

  if (wasDefended) {
    game.discardPile.push(game.attackCard, game.defenseCard);
    game.attacker = oldDefender;
    game.defender = oldAttacker;
  } else {
    game.players[oldDefender].hand.push(game.attackCard);
  }

  game.attackCard = null;
  game.defenseCard = null;
  drawToHand(game, game.attacker);
  drawToHand(game, game.defender);

  const [playerCards, botCards] = [
    game.players.player.hand.length,
    game.players.bot.hand.length,
  ];
  if (game.drawPile.length === 0) {
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

  game.phase = game.result ? "finished" : "attack";
}

export function playDefense(game, cardId) {
  if (game.phase !== "defend" || game.result || !game.attackCard) return false;
  const hand = game.players[game.defender].hand;
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1 || !canDefend(game.attackCard, hand[cardIndex], game.trumpSuit)) {
    return false;
  }

  [game.defenseCard] = hand.splice(cardIndex, 1);
  game.phase = "defense-reveal";
  return true;
}

export function takeAttack(game) {
  if (game.phase !== "defend" || game.result || !game.attackCard) return false;
  game.phase = "take-reveal";
  return true;
}

export function resolveExchange(game) {
  if (game.phase === "defense-reveal") {
    finishExchange(game, true);
    return true;
  }
  if (game.phase === "take-reveal") {
    finishExchange(game, false);
    return true;
  }
  return false;
}

export function chooseRandomCard(cards, random = Math.random) {
  if (cards.length === 0) return null;
  return cards[Math.floor(random() * cards.length)];
}
