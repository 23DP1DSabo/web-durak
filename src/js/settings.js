import { setTheme } from "./theme.js";
const settingsStatus = document.querySelector("#settings-status");
const messages = {
  local: "Tēma saglabāta šajā pārlūkā.",
  saving: "Tēma nomainīta. Saglabā kontā…",
  saved: "Tēma saglabāta kontā.",
  retry: "Tēma saglabāta šajā pārlūkā. Saglabāšanu kontā atkārtosim nākamajā lapā vai pēc savienojuma atjaunošanās.",
};
window.addEventListener("durak-theme-status", (event) => {
  settingsStatus.textContent = messages[event.detail] || "";
  settingsStatus.dataset.state = event.detail === "retry" ? "error" : "success";
});
document.querySelectorAll('input[name="theme"]').forEach((input) => {
  input.addEventListener("change", () => setTheme(input.value));
});
