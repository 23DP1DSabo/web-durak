import { queueRoomExit } from "./room-exit.js";
import { io } from "socket.io-client";
import { attachCardDrag, dropMove } from "./card-drag.js";
import winnerIcon from "../images/crown_winner.png";
import loserIcon from "../images/jester_hat_loser.png";

const images = import.meta.glob(
  [
    "../images/PNG-cards-1.3/{6,7,8,9,10}_of_*.png",
    "../images/PNG-cards-1.3/{jack,queen,king}_of_*2.png",
    "../images/PNG-cards-1.3/ace_of_*.png",
  ],
  { eager: true, query: "?url", import: "default" },
);
const $ = (selector) => document.querySelector(selector);
const code = new URLSearchParams(location.search).get("code").toUpperCase();
const modeNames = {
  classic: "Klasiskais duraks",
  passing: "Padošanu duraks",
  japan: "Japāņu duraks",
  duraklash: "DuraKlash",
};
const suits = {
  clubs: "kreiči",
  diamonds: "kāravi",
  hearts: "erceni",
  spades: "pīķi",
};
export function startTable({ connection: localConnection = null } = {}) {
  let state = null,
    selected = [],
    dragging = false,
    busy = false,
    connected = false,
    receivedAt = 0;
  const socket = localConnection || io({ autoConnect: false });
  const opponents = $(".opponent-seat");
  opponents.classList.add("multiplayer-opponents");
  opponents.setAttribute("aria-label", "Pārējie spēlētāji");
  $("#match-code").textContent = code;
  $("#match-time-limit").textContent = localConnection
    ? "Spēle pret botu"
    : "Multiplayer · 2–6 spēlētāji";
  document.body.classList.add("drag-table");
  $("#take-card").textContent = "Paņemt kārtis";
  $("#return-to-room").href = "./index.html";
  const restartButton = $("#restart-game");
  // restartButton.textContent = "Turpināt nākamo kārtu";
  const connection = document.createElement("p");
  connection.className = "multiplayer-connection";
  connection.setAttribute("role", "status");
  $(".game-table-header").append(connection);

  const resultActions = $(".game-result-actions");

  const nextRoundStatus = document.createElement("p");
  nextRoundStatus.className = "next-round-status";
  nextRoundStatus.setAttribute("role", "status");
  nextRoundStatus.hidden = true;

  resultActions.prepend(nextRoundStatus);

  restartButton.onclick = async () => {
    if (
      !state?.result ||
      busy ||
      !connected ||
      !state.nextRound?.canContinue ||
      !state.nextRound?.canVote
    ) {
      return;
    }

    const nextRound = state.nextRound;

    if (!nextRound?.canVote) {
      nextRoundStatus.textContent =
        "Lai turpinātu multiplayer spēli, nepieciešami vismaz 2 spēlētāji.";
      nextRoundStatus.hidden = false;
      return;
    }

    busy = true;
    render();

    try {
      const data = await socket.timeout(10000).emitWithAck(
        "game:ready-next",
        {
          code,
          version: state.version,
        },
      );

      if (data.error) {
        throw new Error(data.error);
      }

      accept(data.game);
    } catch (error) {
      connection.textContent =
        error.message || "Neizdevās pieteikties nākamajai kārtai.";

      if (socket.connected) await join();
    } finally {
      busy = false;
      render();
    }
  };

  const cardImage = (card) => {
    const image = document.createElement("img");
    image.src = images[`../images/PNG-cards-1.3/${card.image}`];
    image.alt = `${card.rank} · ${suits[card.suit]}`;
    return image;
  };
  const format = (ms) => {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  let rejoinTimer = null;
  let returningToLobby = false;
  function accept(game) {
    if (state && game.version < state.version) return;
    if (game.nextRound?.lobbyCode && !localConnection) {
      if (returningToLobby) return;
      returningToLobby = true;
      clearTimeout(rejoinTimer);
      const url = new URL("./room.html", location.href);
      url.searchParams.set("code", game.nextRound.lobbyCode);
      url.searchParams.set("mode", game.mode);
      url.searchParams.set("role", "player");
      location.replace(url);
      return;
    }
    clearTimeout(rejoinTimer);
    connected = true;
    connection.textContent = "Savienots";
    const changed = !state || state.version !== game.version;
    state = game;
    receivedAt = performance.now();
    selected = selected.filter((id) => state.hand.some((c) => c.id === id));

    // closee the previous rounds result dialog, when a new round starts
    if (!game.result) {
      const dialog = $("#game-result-dialog");
      if (dialog?.open) dialog.close();

      nextRoundStatus.hidden = true;
      restartButton.disabled = false;
    }

    if (changed) render();
    else updateClocks();
  }
  async function join() {
    clearTimeout(rejoinTimer);
    busy = true;
    render();
    try {
      const data = await socket
        .timeout(10000)
        .emitWithAck("game:join", { code });
      if (data.error)
        throw Object.assign(new Error(data.error), { status: data.status });
      connected = true;
      accept(data.game);
      connection.textContent = "Savienots";
    } catch (error) {
      connected = false;
      connection.textContent =
        error.message || "Neizdevās pievienoties spēlei.";
      if (socket.connected && ![401, 403, 404].includes(error.status)) {
        rejoinTimer = setTimeout(join, 2500);
      }
    } finally {
      busy = false;
      render();
    }
  }
  async function move(type, cardId, extra = {}) {
    if (busy || !connected || !state || state.result) return;
    busy = true;
    render();
    try {
      const data = await socket.timeout(10000).emitWithAck("game:move", {
        version: state.version,
        move: { type, cardId, ...extra, bout: state.bout },
      });
      if (data.error)
        throw Object.assign(new Error(data.error), { status: data.status });
      selected = [];
      accept(data.game);
      connection.textContent = "Savienots";
    } catch (error) {
      connection.textContent =
        error.message || "Savienojums pārtrūka. Galds tiks atjaunots.";
      // Never replay a move after an ambiguous timeout; request the authoritative state.
      if (socket.connected) await join();
    } finally {
      busy = false;
      render();
    }
  }
  function render() {
    if (dragging) return;
    const buttons = [
      "#play-card",
      "#take-card",
      "#pass-card",
      "#finish-attack",
    ];
    for (const id of buttons) $(id).disabled = true;
    if (!state) return;
    const self = state.players.find((p) => p.id === state.selfId);
    const turn = state.players.find((p) => p.id === state.actor);
    $("#match-mode").textContent = modeNames[state.mode] || state.mode;
    $("#match-player-name").textContent = self.name;
    $(".player-avatar").textContent = self.name.charAt(0).toUpperCase();
    $("#game-status").textContent = state.result
      ? resultMessage()
      : self.out
        ? self.exitReason === "resign"
          ? "Tu padevies. Pārējie turpina spēli."
          : self.exitReason === "timeout"
            ? "Tev beidzās laiks. Pārējie turpina spēli."
            : "Tu esi izgājis. Gaidi partijas beigas."
        : state.phase === "taking"
          ? state.selfId === state.defender
            ? "Tu ņemsi kārtis. Gaidi, kamēr pārējie pabeidz piemest."
            : state.legal.attack.length || state.legal.finish
              ? "Pretinieks ņems kārtis. Piemet vai pabeidz savu gājienu."
              : `Gaidi, kamēr ${turn?.name || "uzbrucējs"} pabeidz piemest.`
          : state.selfId === state.defender && state.attacks.length
            ? "Velc kārti uz to uzbrukuma kārti, kuru vēlies nokaut."
            : state.legal.attack.length
              ? "Velc kārtis uz brīvo vietu. Vari piemest arī aizsardzības laikā."
              : state.legal.finish
                ? "Vari apstiprināt piemešanas beigas. Pēc jaunas kārts jāapstiprina vēlreiz."
                : `Gaidi: ${turn?.name || "pārējos spēlētājus"}.`;
    opponents.replaceChildren();
    for (const p of state.players.filter((p) => p.id !== state.selfId)) {
      const seat = document.createElement("section");
      seat.className = "multiplayer-seat";
      if (p.id === state.actor) seat.classList.add("is-active");
      const name = document.createElement("h2");
      name.textContent = p.name;
      const detail = document.createElement("p");
      detail.textContent = p.out
        ? p.exitReason === "resign"
          ? "Padevās"
          : p.exitReason === "timeout"
            ? "Beidzās laiks"
            : p.exitReason === "inactive"
              ? "Neaktīvs · laiks beidzās"
              : "Izgājis"
        : `${p.count} kārtis${p.id === state.attacker ? " · Uzbrūk" : p.id === state.defender ? " · Aizsargājas" : ""}`;
      const clock = document.createElement("time");
      clock.dataset.clock = p.id;
      const cards = document.createElement("div");
      cards.className = "multiplayer-card-backs";
      for (let i = 0; i < Math.min(6, p.count); i++) {
        const back = document.createElement("span");
        back.className = "card-back";
        back.setAttribute("aria-hidden", "true");
        cards.append(back);
      }
      seat.append(name, detail, clock, cards);
      opponents.append(seat);
    }
    const hand = $("#player-hand");
    hand.replaceChildren();
    const allowed = new Set([
      ...state.legal.attack,
      ...state.legal.defend,
      ...state.legal.pass,
    ]);
    for (const card of state.hand) {
      const button = document.createElement("button");
      button.className = "hand-card";
      button.type = "button";
      button.dataset.cardId = card.id;
      button.setAttribute("aria-pressed", String(selected.includes(card.id)));
      button.setAttribute("aria-label", `${card.rank} · ${suits[card.suit]}`);
      button.disabled = busy || !connected || !allowed.has(card.id);
      button.append(cardImage(card));
      button.onclick = () => {
        if (selected.includes(card.id))
          selected = selected.filter((id) => id !== card.id);
        else if (state.legal.attack.includes(card.id)) selected.push(card.id);
        else selected = [card.id];
        render();
      };
      hand.append(button);
    }
    const table = $("#played-cards");
    table.replaceChildren();
    state.attacks.forEach((card, i) => {
      const pair = document.createElement("div");
      pair.className = "played-card-pair";
      pair.dataset.targetId = card.id;
      if (!state.defenses[i]) {
        pair.dataset.dropKind = "defend";
        pair.tabIndex = 0;
        pair.setAttribute("role", "button");
        pair.setAttribute(
          "aria-label",
          `Nokaut ${card.rank} ${suits[card.suit]}`,
        );
        pair.classList.toggle(
          "drop-available",
          Boolean(dropMove(state, selected, "defend", card.id)),
        );
        pair.onclick = () => playDrop(selected, "defend", card.id);
        pair.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            playDrop(selected, "defend", card.id);
          }
        };
      }
      const attack = cardImage(card);
      attack.className = "played-card attack-card";
      pair.append(attack);
      if (state.defenses[i]) {
        const defense = cardImage(state.defenses[i]);
        defense.className = "played-card defense-card";
        pair.append(defense);
      }
      table.append(pair);
    });
    const zone = (kind, label) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "card-drop-zone";
      el.dataset.dropKind = kind;
      el.textContent = label;
      el.classList.toggle(
        "drop-available",
        Boolean(dropMove(state, selected, kind)),
      );
      el.onclick = () => playDrop(selected, kind);
      table.append(el);
    };
    if (
      !state.result &&
      !self.out &&
      (state.legal.attack.length || state.legal.finish)
    )
      zone(
        "attack",
        state.attacks.length
          ? `Piemest · ${state.attacks.length}/${state.limit}`
          : "Uzbrukt · velc kārti šeit",
      );
    if (
      state.mode === "passing" &&
      state.selfId === state.defender &&
      state.attacks.length &&
      !state.result
    )
      zone(
        "pass",
        state.legal.pass.length
          ? "Padot → velc vienādas vērtības kārti šeit"
          : "Padot šobrīd nevar",
      );
    $("#trump-card").src =
      images[`../images/PNG-cards-1.3/${state.trumpCard.image}`];
    $("#trump-card").alt = `Trumpis: ${suits[state.trumpCard.suit]}`;
    $("#draw-pile-count").textContent = `Kavā: ${state.drawCount}`;
    $("#draw-pile").hidden = !state.drawCount;
    const attackMove = dropMove(state, selected, "attack");
    $("#play-card").hidden = !state.legal.attack.length;
    $("#play-card").textContent =
      selected.length > 1
        ? `Izspēlēt ${selected.length} kārtis`
        : "Izspēlēt izvēlēto";
    $("#play-card").disabled = busy || !connected || !attackMove;
    $("#take-card").hidden = !state.legal.take;
    $("#take-card").disabled = busy || !connected || !state.legal.take;
    $("#pass-card").hidden = true; // Transfer has its own explicit drop/click target.
    $("#finish-attack").hidden = !state.legal.finish;
    $("#finish-attack").disabled = busy || !connected || !state.legal.finish;
    $("#finish-attack").textContent =
      state.selfId === state.attacker && state.attackers?.length > 1 && !state.throwInsOpen
        ? "Beigt uzbrukt"
        : "Beigt piemest";
    updateClocks();
    if (state.result) {
      $("#game-result-title").textContent = resultMessage();
      const icon = $("#game-result-icon");
      const lost = (state.result.losers ?? [state.result.loser]).includes(state.selfId);
      icon.hidden = state.result.loser === null && !lost;
      icon.src = lost ? loserIcon : winnerIcon;
      icon.alt = lost ? "Zaudējums" : "Uzvara";
      if (!$("#game-result-dialog").open) $("#game-result-dialog").showModal();

      const nextRound = state.nextRound;

      const canShowRestart =
        Boolean(nextRound?.canVote && nextRound?.canContinue) &&
        connected &&
        !busy;

      restartButton.hidden = !canShowRestart;
      restartButton.disabled = !canShowRestart;

      nextRoundStatus.hidden = !nextRound?.canVote;
      if (nextRound?.canVote && !nextRound.canContinue) {
        nextRoundStatus.textContent = "Pārējie spēlētāji ir izgājuši. Jaunai spēlei vajadzīgi vismaz 2 spēlētāji.";
      }

      if (canShowRestart) {
        nextRoundStatus.textContent =
          `${nextRound.readyCount} / ${nextRound.required} spēlētāji gatavi nākamajai kārtai.`;

        restartButton.textContent = nextRound.selfReady
          ? "Gatavs ✓ (atcelt)"
          : "Turpināt nākamo kārtu";
      }
    } else {
      nextRoundStatus.hidden = true;
      restartButton.hidden = true;
      restartButton.disabled = true;
      restartButton.textContent = "Turpināt nākamo kārtu";

      const dialog = $("#game-result-dialog");
      if (dialog?.open) dialog.close();
    }
  }
  function resultMessage() {
    const r = state.result;
    const self = state.players.find((p) => p.id === state.selfId);
    if (self.exitReason === "resign") return "Tu padevies. Partija ir beigusies.";
    if (self.exitReason === "timeout") return "Tev beidzās laiks. Tu zaudēji.";
    if (self.exitReason === "inactive") return "Laiks beidzās, neizpildot nevienu gājienu. Tika pieņemts, ka pameti spēli.";
    if (r.loser === null) return "Neizšķirts!";
    const loser = state.players.find((p) => p.id === r.loser)?.name;
    const reason =
      r.reason === "timeout"
        ? `${loser} beidzās laiks.`
        : r.reason === "resign"
          ? `${loser} padevās.`
          : `Duraks: ${loser}.`;
    return `${r.loser === state.selfId ? "Tu zaudēji." : "Tu uzvarēji!"} ${reason}`;
  }
  function updateClocks() {
    if (!state) return;
    for (const p of state.players) {
      const ms =
        p.remainingMs -
        (p.id === state.actor ? performance.now() - receivedAt : 0);
      const el =
        p.id === state.selfId
          ? $("#player-time")
          : opponents.querySelector(`[data-clock="${p.id}"]`);
      if (el) el.textContent = format(ms);
    }
  }
  function playDrop(ids, kind, targetId) {
    const action = dropMove(state, ids, kind, targetId);
    if (!action || busy || !connected) {
      connection.textContent = "Šeit izvēlēto kārti nevar izspēlēt.";
      return;
    }
    void move(action.type, action.cardId, action);
  }
  attachCardDrag({
    hand: $("#player-hand"),
    getCards: (id) => (selected.includes(id) ? [...selected] : [id]),
    canDrop: (ids, kind, targetId) =>
      !busy && connected && dropMove(state, ids, kind, targetId),
    onStart: () => {
      dragging = true;
    },
    onEnd: () => {
      dragging = false;
      render();
    },
    onDrop: playDrop,
  });
  $("#play-card").onclick = () => playDrop(selected, "attack");
  $("#take-card").onclick = () => move("take");
  $("#finish-attack").onclick = () => move("finish");
  let exiting = false;
  const exitTable = async (event) => {
    event.preventDefault();
    if (exiting) return;
    if (busy || !connected || !state) {
      connection.textContent = "Pagaidi, līdz atjaunojas savienojums ar serveri.";
      return;
    }
    if (state.result || state.players.find((p) => p.id === state.selfId)?.out) {
      exiting = true;
      if (!localConnection && !queueRoomExit({ code, selfId: state.selfId })) {
        try {
          const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/leave`, {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ membershipId: state.selfId }),
          });
          if (!response.ok) throw new Error("Neizdevās pamest spēli. Mēģini vēlreiz.");
        } catch (error) {
          exiting = false;
          nextRoundStatus.hidden = false;
          nextRoundStatus.textContent = error.message;
          return;
        }
      }
      return location.assign("./index.html");
    }
    if (!confirm("Pamest spēli un atzīt zaudējumu?")) return;
    await move("resign");
    if (state?.result || state?.players.find((p) => p.id === state.selfId)?.out)
      location.assign("./index.html");
  };
  $("#return-to-room").onclick = exitTable;
  $(".game-result-menu-link").onclick = exitTable;
  socket.on("connect", join);
  socket.on("game:state", accept);
  socket.on("game:error", (message) => {
    connection.textContent = message;
  });
  socket.on("disconnect", () => {
    connected = false;
    busy = false;
    connection.textContent = "Savienojums pārtrūka. Mēģina atjaunot…";
    render();
  });
  socket.on("connect_error", () => {
    connected = false;
    connection.textContent = "Serveris nav sasniedzams. Mēģina atjaunot…";
    render();
  });
  let clock = setInterval(updateClocks, 250);
  window.addEventListener("pagehide", () => {
    clearInterval(clock);
    clearTimeout(rejoinTimer);
    socket.disconnect();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clock = setInterval(updateClocks, 250);
      socket.connect();
    }
  });
  connection.textContent = "Pievienojas spēlei…";
  socket.connect();
}
