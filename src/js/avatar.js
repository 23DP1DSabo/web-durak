// Use DOM nodes so player-supplied names and URLs never become HTML.
export function renderAvatar(element, user, previewUrl = null) {
  const name = user?.username || user?.name || "Viesis";
  element.classList.add("user-avatar");
  element.textContent = name.trim().charAt(0).toLocaleUpperCase() || "D";
  const source = previewUrl || user?.avatar;
  if (!source) return;
  try {
    const url = new URL(source, window.location.href);
    if (!["http:", "https:"].includes(url.protocol) && !(previewUrl && url.protocol === "blob:")) return;
    const image = document.createElement("img");
    image.alt = `${name} profila bilde`;
    image.decoding = "async";
    image.addEventListener("error", () => {
      if (image.parentNode === element) element.textContent = name.trim().charAt(0).toLocaleUpperCase() || "D";
    });
    image.src = url.href;
    element.replaceChildren(image);
  } catch { /* Keep the initial when the stored URL is invalid. */ }
}
