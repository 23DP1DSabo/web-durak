import { afterEach, expect, test, vi } from "vitest";
afterEach(() => {
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
