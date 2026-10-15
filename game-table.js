import {
  chooseRandomCard,
  cardImageFilename,
  createGame,
  getLegalDefenses,
  playAttack,
  playDefense,
  resolveExchange,
  takeAttack,
} from "./game-logic.js";

const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
  duraklash: "DuraKlash",
};
const suitNames = {
  clubs: "kreiči",
  diamonds: "kāravi",
  hearts: "erceni",
  spades: "pīķi",
};
const rankNames = {
  6: "sešinieks",
  7: "septiņnieks",
  8: "astoņnieks",
  9: "devītnieks",
  10: "desmitnieks",
  11: "kalps",
  12: "dāma",
  13: "kungs",
  14: "dūzis",
};

const cardImages = import.meta.glob([
  "./images/PNG-cards-1.3/{6,7,8,9,10}_of_{clubs,diamonds,hearts,spades}.png",
  "./images/PNG-cards-1.3/{jack,queen,king}_of_{clubs,diamonds,hearts,spades}2.png",
  "./images/PNG-cards-1.3/ace_of_{clubs,diamonds,hearts,spades}.png",
  "./images/PNG-cards-1.3/ace_of_spades2.png",
], {
  eager: true,
  query: "?url",
  import: "default",
});
const parameters = new URLSearchParams(window.location.search);
const roomCode = parameters.get("code")?.toUpperCase() ?? "";
let roomState;
try {
  roomState = JSON.parse(sessionStorage.getItem(`durak-room:${roomCode}`) ?? "null");
} catch {
  roomState = null;
}

const mode = roomState?.mode ?? parameters.get("mode") ?? "classic";
const playerName = parameters.get("name") ?? "Spēlētājs";
const role = parameters.get("role") ?? "player";
const timeLimit = String(roomState?.timeLimitSeconds ?? parameters.get("timeLimit") ?? "600");
const validTimeLimits = new Set(["60", "180", "300", "600"]);
const playerHand = document.querySelector("#player-hand");
const opponentHand = document.querySelector("#opponent-hand");
const playButton = document.querySelector("#play-card");
const takeButton = document.querySelector("#take-card");
const statusMessage = document.querySelector("#game-status");
let game;
let selectedCardId = null;
let botTimer = null;

function imageUrl(card) {
  return cardImages[`./images/PNG-cards-1.3/${card.image}`];
}

function cardDescription(card) {
  return `${rankNames[card.rank]} ${suitNames[card.suit]}`;
}

function renderHand(container, cards, owner, activeCards) {
  container.replaceChildren();
  for (const card of cards) {
    if (owner === "bot") {
      const back = document.createElement("span");
      back.className = "card-back";
      back.setAttribute("aria-hidden", "true");
      container.append(back);
      continue;
    }

    const button = document.createElement("button");
    button.className = "hand-card";
    button.type = "button";
    button.dataset.cardId = card.id;
    button.setAttribute("aria-label", `Atlasīt ${cardDescription(card)}`);
    button.setAttribute("aria-pressed", String(selectedCardId === card.id));
    button.disabled = !activeCards.includes(card.id);
    const image = document.createElement("img");
    image.src = imageUrl(card);
    image.alt = cardDescription(card);
    button.append(image);
    button.addEventListener("click", () => {
      selectedCardId = selectedCardId === card.id ? null : card.id;
      render();
    });
    container.append(button);
  }
}

function currentStatus() {
  if (game.result) return game.result.message;
  if (game.phase === "defense-reveal") return game.defender === "bot" ? "Bots aizsargājas." : "Aizsardzība nolikta.";
  if (game.phase === "take-reveal") return game.defender === "bot" ? "Bots paņem kārti." : "Tu paņem kārti.";
  if (game.phase === "attack") {
    return game.attacker === "player" ? "Tavs gājiens — izvēlies uzbrukuma kārti." : "Bots uzbrūk…";
  }
  return game.defender === "player" ? "Aizsargājies vai paņem kārti." : "Bots izvēlas gājienu…";
}

function render() {
  const playerActiveCards = game.phase === "attack" && game.attacker === "player"
    ? game.players.player.hand.map((card) => card.id)
    : game.phase === "defend" && game.defender === "player"
      ? getLegalDefenses(game.players.player.hand, game.attackCard, game.trumpSuit).map((card) => card.id)
      : [];

  renderHand(playerHand, game.players.player.hand, "player", playerActiveCards);
  renderHand(opponentHand, game.players.bot.hand, "bot", []);

  const trumpCard = { rank: 14, suit: game.trumpSuit, image: cardImageFilename(14, game.trumpSuit) };
  const trumpImage = document.querySelector("#trump-card");
  trumpImage.src = imageUrl(trumpCard);
  trumpImage.alt = `Trumpis: ${suitNames[game.trumpSuit]}`;
  document.querySelector("#draw-pile-count").textContent = `Kavā: ${game.drawPile.length}`;
  document.querySelector("#draw-pile").hidden = game.drawPile.length === 0;

  renderTableCard(game.attackCard, document.querySelector("#attack-card"));
  renderTableCard(game.defenseCard, document.querySelector("#defense-card"));

  statusMessage.textContent = currentStatus();
  playButton.disabled = !selectedCardId || !playerActiveCards.includes(selectedCardId);
  playButton.textContent = game.phase === "defend" ? "Aizsargāties" : "Uzbrukt";
  playButton.hidden = !(
    (game.phase === "attack" && game.attacker === "player")
    || (game.phase === "defend" && game.defender === "player")
  );
  takeButton.hidden = game.phase !== "defend" || game.defender !== "player";
  takeButton.disabled = game.phase !== "defend" || game.defender !== "player";

  if (game.result) {
    document.querySelector("#restart-game").hidden = false;
  }
  scheduleBotTurn();
}

function renderTableCard(card, imageElement) {
  if (!card) {
    imageElement.hidden = true;
    imageElement.removeAttribute("src");
    return;
  }
  imageElement.src = imageUrl(card);
  imageElement.alt = cardDescription(card);
  imageElement.hidden = false;
}

function schedule(delay, callback) {
  if (botTimer !== null) window.clearTimeout(botTimer);
  botTimer = window.setTimeout(() => {
    botTimer = null;
    callback();
  }, delay);
}

function completePlayerAttack() {
  if (!selectedCardId || !playAttack(game, selectedCardId)) return;
  selectedCardId = null;
  render();
}

function completePlayerDefense() {
  if (!selectedCardId || !playDefense(game, selectedCardId)) return;
  selectedCardId = null;
  render();
}

function completePlayerTake() {
  selectedCardId = null;
  if (takeAttack(game)) render();
}

function scheduleBotTurn() {
  if (botTimer !== null || game.result) return;
  if (game.phase === "defense-reveal" || game.phase === "take-reveal") {
    schedule(1800, () => {
      resolveExchange(game);
      render();
    });
    return;
  }
  if (game.phase === "attack" && game.attacker === "bot") {
    schedule(1200, () => {
      const card = chooseRandomCard(game.players.bot.hand);
      if (card) playAttack(game, card.id);
      render();
    });
  } else if (game.phase === "defend" && game.defender === "bot") {
    schedule(1200, () => {
      const legalCards = getLegalDefenses(game.players.bot.hand, game.attackCard, game.trumpSuit);
      const options = [...legalCards, null];
      const choice = chooseRandomCard(options);
      if (choice) playDefense(game, choice.id);
      else takeAttack(game);
      render();
    });
  }
}

if (!/^[A-Z0-9]{8}$/.test(roomCode) || !validTimeLimits.has(timeLimit)) {
  window.location.replace("./index.html");
} else {
  document.querySelector("#match-mode").textContent = modeNames[mode] ?? "Spēle";
  document.querySelector("#match-code").textContent = roomCode;
  document.querySelector("#match-time-limit").textContent = `${Number(timeLimit) / 60} min katram`;
  document.querySelector("#match-player-name").textContent = playerName;
  document.querySelector(".player-avatar").textContent = playerName.trim().charAt(0).toUpperCase() || "D";
  document.querySelector(".opponent-avatar").textContent = "B";

  const returnUrl = new URL("./room.html", window.location.href);
  returnUrl.searchParams.set("mode", mode);
  returnUrl.searchParams.set("code", roomCode);
  returnUrl.searchParams.set("role", role);
  document.querySelector("#return-to-room").href = returnUrl;

  playButton.addEventListener("click", () => {
    if (game.phase === "attack") completePlayerAttack();
    else completePlayerDefense();
  });
  takeButton.addEventListener("click", () => {
    completePlayerTake();
  });
  document.querySelector("#restart-game").addEventListener("click", () => {
    if (botTimer !== null) window.clearTimeout(botTimer);
    botTimer = null;
    selectedCardId = null;
    game = createGame();
    render();
  });

  if (roomState) {
    roomState.status = "active";
    sessionStorage.setItem(`durak-room:${roomCode}`, JSON.stringify(roomState));
  }

  game = createGame();
  render();
}
