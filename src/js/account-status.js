import { fetchCurrentUser } from "./current-user.js";
const link = document.querySelector("#account-link");
const friendsNavItem = document.querySelector("#friends-nav-item");
async function refreshAccount() {
  try {
    const response = await fetchCurrentUser();
    if (response.status === 401) {
      link.textContent = "Pieslēgties";
      friendsNavItem.hidden = true;
      return;
    }
    if (!response.ok) return;
    const { user } = await response.json();
    link.textContent = user.name || "Mans konts";
    friendsNavItem.hidden = false;
  } catch {
    // Keep navigation usable if the API is temporarily unavailable.
  }
}
window.addEventListener("pageshow", refreshAccount);
