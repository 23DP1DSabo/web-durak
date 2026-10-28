import { fetchCurrentUser, getCachedAccount } from "./current-user.js";
const link = document.querySelector("#account-link");
const friendsNavItem = document.querySelector("#friends-nav-item");
const adminNavItem = document.querySelector("#admin-nav-item");
function renderAccount(user) {
  link.textContent = user?.username || "Pieslēgties";
  friendsNavItem.hidden = !user;
  const historyNavItem = document.querySelector("#history-nav-item");
  if (historyNavItem) historyNavItem.hidden = !user;
  adminNavItem.hidden = user?.role !== "ADMIN";
}
async function refreshAccount() {
  try {
    const response = await fetchCurrentUser();
    if (response.status === 401) return renderAccount(null);
    if (response.ok) renderAccount((await response.json()).user);
  } catch { /* Keep the last known navigation during a temporary network failure. */ }
}
renderAccount(getCachedAccount());
void refreshAccount();
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    renderAccount(getCachedAccount());
    void refreshAccount();
  }
});
window.addEventListener("durak-account-changed", (event) => renderAccount(event.detail));
