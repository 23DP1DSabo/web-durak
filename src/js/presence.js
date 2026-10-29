import { fetchCurrentUser } from "./current-user.js";

// The admin panel shows a user as online while one of their pages is open.
// Browsers throttle background tabs to about one timer per minute, which this
// interval already matches; the server allows three minutes between beats.
setInterval(() => {
  fetchCurrentUser({ refresh: true }).catch(() => {});
}, 60 * 1000);
