// Share only simultaneous/nearby reads on this page. Responses are cloned so
// callers can consume JSON independently; credentials never enter localStorage.
let pending = null;
let requestedAt = 0;
export function fetchCurrentUser({ refresh = false } = {}) {
  if (!pending || refresh || Date.now() - requestedAt > 1000) {
    requestedAt = Date.now();
    const request = fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    pending = request;
    request.catch(() => {
      if (pending === request) pending = null;
    });
  }
  return pending.then((response) => response.clone());
}
