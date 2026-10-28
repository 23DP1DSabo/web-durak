import { afterEach, expect, test, vi } from "vitest";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});
test("theme and navigation share the request but can both read their response", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ user: { username: "player" } })),
    );
  vi.stubGlobal("fetch", fetch);
  const { fetchCurrentUser } = await import("../src/js/current-user.js");
  const [a, b] = await Promise.all([fetchCurrentUser(), fetchCurrentUser()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await a.json()).toEqual(await b.json());
  await fetchCurrentUser({ refresh: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
test("a failed account read can be retried immediately", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const { fetchCurrentUser } = await import("../src/js/current-user.js");
  await expect(fetchCurrentUser()).rejects.toThrow("offline");
  await expect(fetchCurrentUser()).resolves.toBeInstanceOf(Response);
  expect(fetch).toHaveBeenCalledTimes(2);
});

function fakeStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
test("cache stores only navigation details and is cleared by logout or an expired session", async () => {
  const storage = fakeStorage();
  vi.stubGlobal("sessionStorage", storage);
  const user = { id: "1", username: "Player", role: "USER", email: "private@example.com", avatar: "/private.png" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user })))
    .mockResolvedValueOnce(new Response("{}", { status: 401 })));
  const { fetchCurrentUser, getCachedAccount, setCurrentAccount } = await import("../src/js/current-user.js");
  await fetchCurrentUser();
  expect(getCachedAccount()).toMatchObject({ id: "1", username: "Player", role: "USER" });
  expect(getCachedAccount()).not.toHaveProperty("email");
  expect(getCachedAccount()).not.toHaveProperty("avatar");
  setCurrentAccount(null);
  expect(getCachedAccount()).toBeNull();
  setCurrentAccount(user);
  await fetchCurrentUser({ refresh: true });
  expect(getCachedAccount()).toBeNull();
});
test("a slow account read stays shared and cannot restore the navigation cache after logout", async () => {
  vi.stubGlobal("sessionStorage", fakeStorage());
  let resolve;
  const fetch = vi.fn(() => new Promise((r) => { resolve = r; }));
  vi.stubGlobal("fetch", fetch);
  const { fetchCurrentUser, getCachedAccount, setCurrentAccount } = await import("../src/js/current-user.js");
  const first = fetchCurrentUser();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 3000);
  const second = fetchCurrentUser();
  expect(fetch).toHaveBeenCalledTimes(1);
  setCurrentAccount(null);
  resolve(new Response(JSON.stringify({ user: { id: "1", username: "Old", role: "USER" } })));
  await Promise.all([first, second]);
  expect(getCachedAccount()).toBeNull();
  vi.restoreAllMocks();
});

const profile = { id: "1", username: "Player", name: "Player Name", email: "qa@example.invalid",
  avatar: "/api/avatars/1?v=test", role: "USER", theme: "DARK", themeVersion: 2 };
test("a successful account lookup warms the profile preview without storing private credentials", async () => {
  const storage = fakeStorage();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    user: { ...profile, passwordHash: "must-not-store", token: "must-not-store", sessions: ["secret"] },
  }))));
  const { fetchCurrentUser, getCachedProfile, setCurrentAccount } = await import("../src/js/current-user.js");
  await fetchCurrentUser();
  expect(getCachedProfile()).toEqual(profile);
  expect(storage.getItem("durak-profile-preview")).not.toContain("must-not-store");
  expect(storage.getItem("durak-profile-preview")).not.toContain("sessions");
  setCurrentAccount({ ...profile, username: "Updated", avatar: null, theme: "MODERN" });
  expect(getCachedProfile()).toMatchObject({ username: "Updated", avatar: null, theme: "MODERN" });
  setCurrentAccount(null);
  expect(getCachedProfile()).toBeNull();
  expect(storage.getItem("durak-profile-preview")).toBeNull();
});
test("expired, malformed or mismatched profile previews are not shown", async () => {
  const storage = fakeStorage();
  vi.stubGlobal("sessionStorage", storage);
  const { setCurrentAccount, getCachedProfile } = await import("../src/js/current-user.js");
  setCurrentAccount(profile);
  const original = storage.getItem("durak-profile-preview");
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 5 * 60 * 1000 + 1);
  expect(getCachedProfile()).toBeNull();
  vi.restoreAllMocks();
  for (const invalid of ["broken-json", JSON.stringify({ savedAt: Date.now(), user: { ...profile, id: "someone-else" } }),
    JSON.stringify({ savedAt: Date.now() + 60000, user: profile })]) {
    storage.setItem("durak-profile-preview", invalid);
    expect(getCachedProfile()).toBeNull();
  }
  storage.setItem("durak-profile-preview", original);
  expect(getCachedProfile()).toEqual(profile);
});
test("expired sessions clear the profile and a late read cannot restore it after logout", async () => {
  const storage = fakeStorage();
  vi.stubGlobal("sessionStorage", storage);
  let resolve;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 }))
    .mockImplementationOnce(() => new Promise((r) => { resolve = r; })));
  const { setCurrentAccount, getCachedProfile, fetchCurrentUser } = await import("../src/js/current-user.js");
  setCurrentAccount(profile);
  await fetchCurrentUser();
  expect(getCachedProfile()).toBeNull();
  expect(storage.getItem("durak-profile-preview")).toBeNull();
  const read = fetchCurrentUser({ refresh: true });
  setCurrentAccount(null);
  resolve(new Response(JSON.stringify({ user: profile })));
  await read;
  expect(getCachedProfile()).toBeNull();
});
