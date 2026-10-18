import { describe, expect, it } from "vitest";
import {
  addAttack,
  createDeck,
  createGame,
  expireTurnTime,
  finishAttack,
  getLegalAttacks,
  getLegalDefenses,
  getLegalPasses,
  passAttack,
  playAttack,
  playDefense,
  resolveExchange,
  takeAttack,
} from "../src/js/game-logic.js";

function card(rank, suit) {
  return { id: `${rank}_${suit}`, rank, suit, image: `${rank}_of_${suit}.png` };
}

function gameState({ mode = "classic", playerHand, botHand, attacker = "player" }) {
  return {
    players: {
      player: { hand: [...playerHand] },
      bot: { hand: [...botHand] },
    },
    drawPile: [],
    discardPile: [],
    trumpSuit: "spades",
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

describe("Durak game logic", () => {
  it("creates a 36-card deck and stores the selected mode", () => {
    expect(createDeck()).toHaveLength(36);
    expect(createGame(() => 0.25, "passing").mode).toBe("passing");
    expect(createGame(() => 0.25, "japan").trumpSuit).toBe("diamonds");
  });

  it("uses the Japanese Durak suit rules only in Japanese mode", () => {
    const japan = gameState({
      mode: "japan",
      playerHand: [card(9, "spades"), card(14, "diamonds"), card(14, "hearts")],
      botHand: [card(10, "spades")],
    });
    japan.trumpSuit = "diamonds";
    playAttack(japan, "9_spades");
    expect(getLegalDefenses(japan.players.bot.hand, japan)).toEqual([card(10, "spades")]);

    const diamondAttack = gameState({
      mode: "japan",
      playerHand: [card(14, "diamonds"), card(14, "hearts")],
      botHand: [card(13, "diamonds"), card(6, "diamonds"), card(14, "spades")],
    });
    diamondAttack.trumpSuit = "diamonds";
    playAttack(diamondAttack, "14_diamonds");
    expect(getLegalDefenses(diamondAttack.players.bot.hand, diamondAttack)).toEqual([]);

    const nonTrumpAttack = gameState({
      mode: "japan",
      playerHand: [card(9, "hearts")],
      botHand: [card(6, "diamonds"), card(10, "hearts"), card(14, "spades")],
    });
    nonTrumpAttack.trumpSuit = "diamonds";
    playAttack(nonTrumpAttack, "9_hearts");
    expect(getLegalDefenses(nonTrumpAttack.players.bot.hand, nonTrumpAttack)).toEqual([
      card(6, "diamonds"),
      card(10, "hearts"),
    ]);

    const classic = gameState({
      playerHand: [card(9, "hearts")],
      botHand: [card(6, "spades"), card(14, "diamonds")],
    });
    playAttack(classic, "9_hearts");
    expect(getLegalDefenses(classic.players.bot.hand, classic)).toEqual([card(6, "spades")]);
  });

  it("allows matching-rank follow-up attacks and resolves every defended pair", () => {
    const lead = card(8, "clubs");
    const followUp = card(8, "hearts");
    const unrelated = card(9, "diamonds");
    const game = gameState({
      playerHand: [lead, followUp, unrelated],
      botHand: [card(10, "clubs"), card(11, "hearts")],
    });

    expect(playAttack(game, lead.id)).toBe(true);
    expect(getLegalAttacks(game.players.player.hand, game)).toEqual([]);
    expect(playDefense(game, "10_clubs")).toBe(true);
    expect(game.phase).toBe("attack-more");
    expect(getLegalAttacks(game.players.player.hand, game)).toEqual([followUp]);
    expect(addAttack(game, unrelated.id)).toBe(false);
    expect(addAttack(game, followUp.id)).toBe(true);
    expect(game.phase).toBe("defend");
    expect(playDefense(game, "11_hearts")).toBe(true);
    expect(game.phase).toBe("attack-more");

    expect(finishAttack(game)).toBe(true);
    expect(game.attacker).toBe("bot");
    expect(game.defender).toBe("player");
    expect(game.discardPile).toHaveLength(4);
    expect(game.attacks).toEqual([]);
    expect(game.defenses).toEqual([]);
    expect(game.result).toEqual({ winner: "bot", message: "Bots uzvarēja!" });
  });

  it("lets a defender take all attacks and defenses on the table", () => {
    const lead = card(8, "clubs");
    const followUp = card(8, "hearts");
    const game = gameState({
      playerHand: [lead, followUp, card(9, "spades")],
      botHand: [card(10, "clubs"), card(11, "diamonds"), card(6, "hearts")],
    });

    playAttack(game, lead.id);
    playDefense(game, "10_clubs");
    expect(addAttack(game, followUp.id)).toBe(true);
    expect(takeAttack(game)).toBe(true);
    expect(resolveExchange(game)).toBe(true);
    expect(game.players.bot.hand).toEqual([
      card(11, "diamonds"),
      card(6, "hearts"),
      lead,
      card(10, "clubs"),
      followUp,
    ]);
    expect(game.attacker).toBe("player");
    expect(game.phase).toBe("attack");
  });

  it("passes an attack to the original attacker using a different-suit card of the same rank", () => {
    const lead = card(6, "hearts");
    const passCard = card(6, "spades");
    const game = gameState({
      mode: "passing",
      playerHand: [lead, card(8, "hearts"), card(7, "clubs")],
      botHand: [passCard, card(9, "hearts")],
    });

    playAttack(game, lead.id);
    expect(getLegalPasses(game.players.bot.hand, game)).toEqual([passCard]);
    expect(passAttack(game, passCard.id)).toBe(true);
    expect(game.attacker).toBe("bot");
    expect(game.defender).toBe("player");
    expect(game.attacks).toEqual([lead, passCard]);
    expect(game.attackLimit).toBe(2);
    expect(getLegalDefenses(game.players.player.hand, game)).toHaveLength(1);
  });

  it("offers every matching pass card so the defender can choose", () => {
    const lead = card(6, "hearts");
    const passCards = [card(6, "clubs"), card(6, "spades")];
    const game = gameState({
      mode: "passing",
      playerHand: [lead, card(8, "hearts"), card(7, "clubs"), card(9, "diamonds")],
      botHand: [...passCards],
    });

    playAttack(game, lead.id);
    expect(getLegalPasses(game.players.bot.hand, game)).toEqual(passCards);
    expect(passAttack(game, passCards[1].id)).toBe(true);
    expect(game.attacks).toEqual([lead, passCards[1]]);
  });

  it("does not allow passing when the next defender cannot cover the table or after a defense", () => {
    const lead = card(6, "hearts");
    const passCard = card(6, "spades");
    const tooSmallHand = gameState({
      mode: "passing",
      playerHand: [lead],
      botHand: [passCard, card(9, "hearts")],
    });
    playAttack(tooSmallHand, lead.id);
    expect(getLegalPasses(tooSmallHand.players.bot.hand, tooSmallHand)).toEqual([]);

    const alreadyDefended = gameState({
      mode: "passing",
      playerHand: [lead, card(8, "clubs"), card(9, "diamonds")],
      botHand: [passCard, card(7, "hearts")],
    });
    playAttack(alreadyDefended, lead.id);
    playDefense(alreadyDefended, "7_hearts");
    expect(getLegalPasses(alreadyDefended.players.bot.hand, alreadyDefended)).toEqual([]);
  });
});


describe("game setup and clock rules", () => {
  it("reserves the visible trump card at the bottom of the draw pile", () => {
    const game = createGame(() => 0.25);
    const dealtCards = [...game.players.player.hand, ...game.players.bot.hand];

    expect(game.drawPile).toHaveLength(24);
    expect(dealtCards).not.toContainEqual(game.trumpCard);
    expect(game.drawPile[0]).toEqual(game.trumpCard);

    for (let drawn = 0; drawn < 23; drawn += 1) {
      game.drawPile.pop();
    }
    expect(game.drawPile.pop()).toEqual(game.trumpCard);
  });

  it("keeps the Japanese trump ace as the last card to be drawn", () => {
    const game = createGame(() => 0.5, "japan");
    expect(game.trumpSuit).toBe("diamonds");
    expect(game.trumpCard).toMatchObject({ rank: 14, suit: "diamonds" });
    expect(game.drawPile[0]).toEqual(game.trumpCard);
    expect([...game.players.player.hand, ...game.players.bot.hand]).not.toContainEqual(game.trumpCard);
  });

  it("ends the game with the other side winning when either clock expires", () => {
    const game = createGame(() => 0.25);
    expect(expireTurnTime(game, "player")).toBe(true);
    expect(game.phase).toBe("finished");
    expect(game.result).toEqual({
      winner: "bot",
      message: "Tavam laikam beidzoties, Bots uzvarēja!",
    });
    expect(expireTurnTime(game, "bot")).toBe(false);

    const botTimedOutGame = createGame(() => 0.25);
    expect(expireTurnTime(botTimedOutGame, "bot")).toBe(true);
    expect(botTimedOutGame.result).toEqual({
      winner: "player",
      message: "Botam beidzās laiks! Tu uzvarēji!",
    });
  });
});
