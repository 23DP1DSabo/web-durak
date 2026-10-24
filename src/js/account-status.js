import { fetchCurrentUser } from "./current-user.js";
const link = document.querySelector("#account-link");
const friendsNavItem = document.querySelector("#friends-nav-item");
const adminNavItem = document.querySelector("#admin-nav-item");
async function refreshAccount() {
  friendsNavItem.hidden = true;
  adminNavItem.hidden = true;
  try {
    const response = await fetchCurrentUser();
    if (response.status === 401) {
      link.textContent = "Pieslēgties";
      return;
    }
    if (!response.ok) return;
    const { user } = await response.json();
    link.textContent = user.username || "Mans konts";
    friendsNavItem.hidden = false;
    adminNavItem.hidden = user.role !== "ADMIN";
  } catch {
    // Keep navigation usable if the API is temporarily unavailable.
  }
}
window.addEventListener("pageshow", refreshAccount);
