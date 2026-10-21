const code = new URLSearchParams(location.search).get("code")?.toUpperCase();
try {
  if (!/^[A-Z0-9]{8}$/.test(code || ""))
    throw new Error("Nederīgs istabas kods.");
  const response = await fetch(`/api/rooms/${code}`, {
    credentials: "same-origin",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  if (!data.room.selfId)
    throw new Error(
      "Tu neesi šīs istabas dalībnieks. Pievienojies istabai sākumlapā.",
    );
  if (data.room.multiplayer) await import("./multiplayer-table.js");
  else if (data.room.status === "active") await import("./game-table.js");
  else throw new Error("Spēle nav aktīva. Atgriezies sākumlapā.");
} catch (error) {
  document.querySelector("#game-status").textContent = error.message;
  document.querySelector("#return-to-room").href = "./index.html";
}
