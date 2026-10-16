const link = document.querySelector("#account-link");
async function refreshAccount() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (response.status === 401) {
      link.textContent = "Pieslēgties";
      return;
    }
    if (!response.ok) return;
    const { user } = await response.json();
    link.textContent = user.name || "Mans konts";
  } catch {
    // Keep navigation usable if the API is temporarily unavailable.
  }
}
window.addEventListener("pageshow", refreshAccount);
