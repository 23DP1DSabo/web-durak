// Themed replacements for alert() and confirm(). They reuse the .room-dialog
// styles, so every theme already covers them, and resolve once closed.
function openDialog({ title, message, buttons }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "room-dialog app-dialog";
    const heading = document.createElement("h2");
    heading.id = `app-dialog-${Date.now()}`;
    heading.textContent = title;
    dialog.setAttribute("aria-labelledby", heading.id);
    const text = document.createElement("p");
    text.className = "app-dialog-message";
    text.textContent = message;
    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";
    let result = false;
    for (const { label, value, className } of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (className) button.className = className;
      button.addEventListener("click", () => {
        result = value;
        dialog.close();
      });
      actions.append(button);
    }
    dialog.append(heading, text, actions);
    // Escape closes the dialog with the default result (cancel).
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
    // Focus the safe choice: "Atcelt" in confirmations, "Labi" in alerts.
    actions.firstElementChild.focus();
  });
}

export function showAlert(message, { title = "Kļūda" } = {}) {
  return openDialog({ title, message, buttons: [{ label: "Labi", value: true }] }).then(() => undefined);
}

export function showConfirm(message, { title = "Apstiprināt", confirmLabel = "Jā", cancelLabel = "Atcelt", danger = false } = {}) {
  return openDialog({
    title,
    message,
    buttons: [
      { label: cancelLabel, value: false, className: "app-dialog-cancel" },
      { label: confirmLabel, value: true, className: danger ? "app-dialog-danger" : "" },
    ],
  });
}
