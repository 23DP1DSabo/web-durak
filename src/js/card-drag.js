// A drop is an explicit action; releasing outside a valid target never plays a card.
export function dropMove(state, ids, kind, targetId) {
  if (!state || state.result || !ids.length) return null;
  const legal = state.legal;
  if (
    kind === "defend" &&
    ids.length === 1 &&
    legal.defenseTargets?.[ids[0]]?.includes(targetId)
  )
    return { type: "defend", cardId: ids[0], targetId };
  if (kind === "pass" && ids.length === 1 && legal.pass.includes(ids[0]))
    return { type: "pass", cardId: ids[0] };
  if (kind === "attack" && ids.every((id) => legal.attack.includes(id))) {
    const cards = ids.map((id) => state.hand.find((c) => c.id === id));
    const limit = state.attacks.length
      ? state.limit
      : Math.min(6, state.players.find((p) => p.id === state.defender).count);
    if (state.attacks.length + ids.length > limit) return null;
    if (!state.attacks.length && !cards.every((c) => c.rank === cards[0].rank))
      return null;
    return { type: "attack", cardIds: ids };
  }
  return null;
}

export function attachCardDrag({
  hand,
  getCards,
  canDrop,
  onStart,
  onEnd,
  onDrop,
}) {
  let drag = null,
    suppressClick = false,
    suppressContextMenu = false;
  const clearHighlights = () =>
    document
      .querySelectorAll(".drop-hover")
      .forEach((el) => el.classList.remove("drop-hover"));
  const targetAt = (e) =>
    document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-drop-kind]");
  const finish = (e, cancelled = false) => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pointerId))
      return;
    const current = drag;
    drag = null;
    if (hand.hasPointerCapture(current.pointerId))
      hand.releasePointerCapture(current.pointerId);
    clearHighlights();
    current.ghost?.remove();
    if (current.started) {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
      const target = cancelled ? null : targetAt(e);
      onEnd();
      if (!cancelled)
        onDrop(current.ids, target?.dataset.dropKind, target?.dataset.targetId);
    }
  };
  hand.addEventListener("dragstart", (e) => e.preventDefault());
  hand.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  hand.addEventListener("pointerdown", (e) => {
    const button = e.target.closest("[data-card-id]");
    if (drag || !button || button.disabled || e.button !== 0) return;
    drag = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      button,
      ids: getCards(button.dataset.cardId),
      started: false,
    };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7)
      return;
    e.preventDefault();
    if (!drag.started) {
      drag.started = true;
      hand.setPointerCapture(e.pointerId);
      const ghost = document.createElement("div");
      ghost.className = "card-drag-ghost";
      ghost.append(drag.button.querySelector("img").cloneNode());
      if (drag.ids.length > 1) {
        const badge = document.createElement("b");
        badge.textContent = `${drag.ids.length} kārtis`;
        ghost.append(badge);
      }
      document.body.append(ghost);
      drag.ghost = ghost;
      onStart();
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    clearHighlights();
    const target = targetAt(e);
    if (
      target &&
      canDrop(drag.ids, target.dataset.dropKind, target.dataset.targetId)
    )
      target.classList.add("drop-hover");
  });
  // A second mouse button does not emit pointerdown while the first is held.
  // Use mousedown to cancel immediately, without waiting for the left release.
  window.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (!drag) {suppressContextMenu = false;return;}
    e.preventDefault();
    suppressContextMenu = true;
    finish({ pointerId: drag.pointerId }, true);
  });
  window.addEventListener("contextmenu", (e) => {
    if (!drag && !suppressContextMenu) return;
    e.preventDefault();
    suppressContextMenu = false;
    if (drag) finish({ pointerId: drag.pointerId }, true);
  });
  window.addEventListener("pointerup", (e) => finish(e));
  window.addEventListener("pointercancel", (e) => finish(e, true));
  hand.addEventListener("lostpointercapture", (e) => {
    // Touch implicitly captures the original button. Moving capture to the hand
    // fires a bubbling loss on that button; it is not a cancelled drag.
    if (e.target === hand) finish(e, true);
  });
  window.addEventListener("blur", () => {
    if (drag) finish({ pointerId: drag.pointerId }, true);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drag) finish({ pointerId: drag.pointerId }, true);
  });
}
