import {
  addAttack,
  chooseRandomCard,
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
} from "./game-logic.js";
import winnerCrown from "../images/crown_winner.png";
import loserJesterHat from "../images/jester_hat_loser.png";

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
  "../images/PNG-cards-1.3/{6,7,8,9,10}_of_{clubs,diamonds,hearts,spades}.png",
  "../images/PNG-cards-1.3/{jack,queen,king}_of_{clubs,diamonds,hearts,spades}2.png",
  "../images/PNG-cards-1.3/ace_of_{clubs,diamonds,hearts,spades}.png",
  "../images/PNG-cards-1.3/ace_of_spades2.png",
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
const passButton = document.querySelector("#pass-card");
const finishAttackButton = document.querySelector("#finish-attack");
const statusMessage = document.querySelector("#game-status");
const playedCards = document.querySelector("#played-cards");
const resultDialog = document.querySelector("#game-result-dialog");
const resultIcon = document.querySelector("#game-result-icon");
const resultTitle = document.querySelector("#game-result-title");
const playerClock = document.querySelector("#player-clock");
const playerTime = document.querySelector("#player-time");
const opponentClock = document.querySelector("#opponent-clock");
const opponentTime = document.querySelector("#opponent-time");
let game;
let selectedCardId = null;
let botTimer = null;
let passSelectionActive = false;
const remainingSeconds = { player: Number(timeLimit), bot: Number(timeLimit) };
let clockDeadline = 0;
let clockTimer = null;
let activeClockPlayer = null;

function imageUrl(card) {
  return cardImages[`../images/PNG-cards-1.3/${card.image}`];
}

function cardDescription(card) {
  return `${rankNames[card.rank]} ${suitNames[card.suit]}`;
}

function renderHand(container, cards, owner, activeCards, passCards = []) {
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
    button.className = `hand-card${passCards.includes(card.id) ? " pass-eligible" : ""}`;
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
  if (game.phase === "take-reveal") return game.defender === "bot" ? "Bots paņem kārti." : "Tu paņem kārti.";
  if (passSelectionActive) return "Izvēlies kārti, ar kuru nodot uzbrukumu.";
  if (game.phase === "attack" || game.phase === "attack-more") {
    return game.attacker === "player" ? "Tavs gājiens — izvēlies uzbrukuma kārti." : "Bots uzbrūk…";
  }
  return game.defender === "player" ? "Aizsargājies vai paņem kārti." : "Bots izvēlas gājienu…";
}

function render() {
  const playerPassCards = game.phase === "defend" && game.defender === "player"
    ? getLegalPasses(game.players.player.hand, game).map((card) => card.id)
    : [];
  const playerActiveCards = passSelectionActive
    ? playerPassCards
    : game.attacker === "player" && (game.phase === "attack" || game.phase === "attack-more")
      ? getLegalAttacks(game.players.player.hand, game).map((card) => card.id)
      : game.phase === "defend" && game.defender === "player"
        ? getLegalDefenses(game.players.player.hand, game).map((card) => card.id)
        : [];

  renderHand(playerHand, game.players.player.hand, "player", playerActiveCards, passSelectionActive ? playerPassCards : []);
  renderHand(opponentHand, game.players.bot.hand, "bot", []);

  const trumpImage = document.querySelector("#trump-card");
  trumpImage.src = imageUrl(game.trumpCard);
  trumpImage.alt = `Trumpis: ${suitNames[game.trumpSuit]}`;
  document.querySelector("#draw-pile-count").textContent = `Kavā: ${game.drawPile.length}`;
  document.querySelector("#draw-pile").hidden = game.drawPile.length === 0;

  renderTableCards();

  statusMessage.textContent = currentStatus();
  playButton.disabled = passSelectionActive || !selectedCardId || !playerActiveCards.includes(selectedCardId);
  playButton.textContent = game.phase === "defend" ? "Aizsargāties" : game.phase === "attack-more" ? "Pievienot kārti" : "Uzbrukt";
  playButton.hidden = !(
    !passSelectionActive
    && ((game.phase === "attack" && game.attacker === "player")
      || (game.phase === "attack-more" && game.attacker === "player")
      || (game.phase === "defend" && game.defender === "player"))
  );
  takeButton.hidden = game.phase !== "defend" || game.defender !== "player";
  takeButton.disabled = game.phase !== "defend" || game.defender !== "player";
  passButton.hidden = game.phase !== "defend" || game.defender !== "player" || game.mode !== "passing";
  passButton.disabled = passSelectionActive
    ? !selectedCardId || !playerPassCards.includes(selectedCardId)
    : playerPassCards.length === 0;
  passButton.textContent = passSelectionActive
    ? selectedCardId ? "Pādoties ar izvēlēto kārti" : "Atcelt izvēli"
    : "Pādoties";
  finishAttackButton.hidden = game.phase !== "attack-more" || game.attacker !== "player";

  if (game.result) {
    showResult();
  }
  syncTurnClock();
  scheduleBotTurn();
}

function renderTableCards() {
  playedCards.replaceChildren();
  game.attacks.forEach((attack, index) => {
    const pair = document.createElement("div");
    pair.className = "played-card-pair";
    pair.append(createTableCard(attack, "attack-card"));
    if (game.defenses[index]) pair.append(createTableCard(game.defenses[index], "defense-card"));
    playedCards.append(pair);
  });
}

function createTableCard(card, type) {
  const image = document.createElement("img");
  image.className = `played-card ${type}`;
  image.src = imageUrl(card);
  image.alt = cardDescription(card);
  return image;
}

function showResult() {
  resultTitle.textContent = game.result.message;
  resultIcon.hidden = !game.result.winner;
  if (game.result.winner) {
    resultIcon.src = game.result.winner === "player" ? winnerCrown : loserJesterHat;
    resultIcon.alt = game.result.winner === "player" ? "Kronis — uzvara" : "Jestera cepure — zaudējums";
  }
  if (!resultDialog.open) resultDialog.showModal();
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function updateClockDisplay() {
  for (const [playerId, clock, display] of [
    ["player", playerClock, playerTime],
    ["bot", opponentClock, opponentTime],
  ]) {
    display.textContent = formatTime(remainingSeconds[playerId]);
    display.dateTime = `PT${remainingSeconds[playerId]}S`;
    clock.classList.toggle("is-low", remainingSeconds[playerId] <= 10);
  }
}

function getActiveClockPlayer() {
  if (game.result) return null;
  if (game.phase === "attack" || game.phase === "attack-more") return game.attacker;
  if (game.phase === "defend") return game.defender;
  return null;
}

function pauseActiveClock() {
  if (clockTimer === null) return;
  window.clearInterval(clockTimer);
  clockTimer = null;
  remainingSeconds[activeClockPlayer] = Math.max(
    0,
    Math.ceil((clockDeadline - Date.now()) / 1000),
  );
  clockDeadline = 0;
  activeClockPlayer = null;
  updateClockDisplay();
}

function syncTurnClock() {
  const nextActivePlayer = getActiveClockPlayer();
  if (activeClockPlayer !== nextActivePlayer) pauseActiveClock();
  if (!nextActivePlayer) {
    return;
  }
  if (clockTimer !== null) return;
  if (remainingSeconds[nextActivePlayer] <= 0) {
    expireTurnTime(game, nextActivePlayer);
    render();
    return;
  }

  activeClockPlayer = nextActivePlayer;
  clockDeadline = Date.now() + remainingSeconds[nextActivePlayer] * 1000;
  clockTimer = window.setInterval(() => {
    remainingSeconds[activeClockPlayer] = Math.max(
      0,
      Math.ceil((clockDeadline - Date.now()) / 1000),
    );
    updateClockDisplay();
    if (Date.now() >= clockDeadline) {
      const loser = activeClockPlayer;
      pauseActiveClock();
      expireTurnTime(game, loser);
      if (botTimer !== null) {
        window.clearTimeout(botTimer);
        botTimer = null;
      }
      render();
    }
  }, 250);
}

function schedule(delay, callback) {
  if (botTimer !== null) window.clearTimeout(botTimer);
  botTimer = window.setTimeout(() => {
    botTimer = null;
    callback();
  }, delay);
}

function completePlayerAttack() {
  if (!selectedCardId) return;
  const played = game.phase === "attack"
    ? playAttack(game, selectedCardId)
    : addAttack(game, selectedCardId);
  if (!played) return;
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

function completePlayerPass() {
  if (passSelectionActive) {
    if (selectedCardId && passAttack(game, selectedCardId)) {
      selectedCardId = null;
      passSelectionActive = false;
      render();
      return;
    }
    if (!selectedCardId) {
      passSelectionActive = false;
      render();
    }
    return;
  }

  const legalPasses = getLegalPasses(game.players.player.hand, game);
  if (legalPasses.length === 1 && passAttack(game, legalPasses[0].id)) {
    selectedCardId = null;
    render();
  } else if (legalPasses.length > 1) {
    passSelectionActive = true;
    selectedCardId = null;
    render();
  }
}

function scheduleBotTurn() {
  if (botTimer !== null || game.result) return;
  if (game.phase === "take-reveal") {
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
  } else if (game.phase === "attack-more" && game.attacker === "bot") {
    schedule(1200, () => {
      const card = chooseRandomCard(getLegalAttacks(game.players.bot.hand, game));
      if (card) addAttack(game, card.id);
      else finishAttack(game);
      render();
    });
  } else if (game.phase === "defend" && game.defender === "bot") {
    schedule(1200, () => {
      const passCards = getLegalPasses(game.players.bot.hand, game);
      if (passCards.length > 0 && Math.random() < 0.35) {
        passAttack(game, chooseRandomCard(passCards).id);
      } else {
        const legalCards = getLegalDefenses(game.players.bot.hand, game);
        const choice = chooseRandomCard([...legalCards, null]);
        if (choice) playDefense(game, choice.id);
        else takeAttack(game);
      }
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
    if (game.phase === "attack" || game.phase === "attack-more") completePlayerAttack();
    else completePlayerDefense();
  });
  takeButton.addEventListener("click", () => {
    completePlayerTake();
  });
  passButton.addEventListener("click", () => {
    completePlayerPass();
  });
  finishAttackButton.addEventListener("click", () => {
    selectedCardId = null;
    if (finishAttack(game)) render();
  });
  document.querySelector("#restart-game").addEventListener("click", () => {
    if (botTimer !== null) window.clearTimeout(botTimer);
    botTimer = null;
    if (clockTimer !== null) window.clearInterval(clockTimer);
    clockTimer = null;
    clockDeadline = 0;
    activeClockPlayer = null;
    remainingSeconds.player = Number(timeLimit);
    remainingSeconds.bot = Number(timeLimit);
    selectedCardId = null;
    passSelectionActive = false;
    resultDialog.close();
    game = createGame(Math.random, mode);
    render();
  });

  if (roomState) {
    roomState.status = "active";
    sessionStorage.setItem(`durak-room:${roomCode}`, JSON.stringify(roomState));
  }

  game = createGame(Math.random, mode);
  updateClockDisplay();
  render();
}
