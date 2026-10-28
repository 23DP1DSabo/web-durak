import { expect, test, vi } from "vitest";
import { createThemeSync, pendingThemeKey } from "../src/js/theme-sync.js";
const user = (theme = "CLASSIC", themeVersion = 0, id = "1") => ({ id, theme, themeVersion, username: "player", role: "USER" });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
  const apply = vi.fn(), status = vi.fn();
  const fetchUser = vi.fn(async () => response({ user: user() }));
  const save = vi.fn(async (theme, version) => response({ user: user(theme, version + 1) }));
  const args = { storage, apply, status, fetchUser, save, ...options };
  return { ...args, controller: createThemeSync(args), data };
}
test("a choice made before the account response is shown immediately and then saved", async () => {
  const read = deferred();
  const f = fixture({ fetchUser: () => read.promise });
  const done = f.controller.sync();
  f.controller.select("DARK");
  expect(f.apply).toHaveBeenLastCalledWith("dark");
  read.resolve(response({ user: user("LIGHT") }));
  await done;
  expect(f.apply).toHaveBeenLastCalledWith("dark");
  expect(f.save).toHaveBeenCalledWith("DARK", 0);
  expect(f.data.has(pendingThemeKey)).toBe(false);
});
test("rapid changes save in order, coalesce intermediate choices and keep the last radio state", async () => {
  const first = deferred();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (theme, version) => response({ user: user(theme, version + 1) }));
  const f = fixture({ save });
  await f.controller.sync();
  f.controller.select("LIGHT");
  f.controller.select("CLASSIC");
  f.controller.select("DARK");
  first.resolve(response({ user: user("LIGHT", 1) }));
  await f.controller.sync();
  expect(save.mock.calls).toEqual([["LIGHT", 0], ["DARK", 1]]);
  expect(f.apply).toHaveBeenLastCalledWith("dark");
  expect(f.data.get("durak-theme")).toBe("dark");
});
test("the next page resumes a pending choice and an older page cannot replace it", async () => {
  const delayed = deferred();
  let stored = user();
  const f = fixture({ save: () => delayed.promise, fetchUser: async () => response({ user: stored }) });
  await f.controller.sync();
  f.controller.select("LIGHT");
  const newPage = fixture({ storage: f.storage,
    fetchUser: async () => response({ user: stored }),
    save: async (theme, version) => {
      if (version !== stored.themeVersion) return response({}, 409);
      stored = user(theme, version + 1);
      return response({ user: stored });
    },
  });
  newPage.controller.select("DARK");
  await newPage.controller.sync();
  expect(stored.theme).toBe("DARK");
  // Old request is rejected by the database version check.
  delayed.resolve(response({}, 409));
  await f.controller.sync();
  expect(f.storage.getItem("durak-theme")).toBe("dark");
});
test("a conflicting save reloads the version and retries the latest selection", async () => {
  const fetchUser = vi.fn().mockResolvedValueOnce(response({ user: user() })).mockResolvedValueOnce(response({ user: user("LIGHT", 3) }));
  const save = vi.fn().mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ user: user("DARK", 4) }));
  const f = fixture({ fetchUser, save });
  await f.controller.sync();
  f.controller.select("DARK");
  await f.controller.sync();
  expect(save.mock.calls).toEqual([["DARK", 0], ["DARK", 3]]);
  expect(f.apply).toHaveBeenLastCalledWith("dark");
});
test("a failed write stays pending and is retried on a later sync", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response({ user: user("DARK", 1) }));
  const f = fixture({ save });
  await f.controller.sync();
  f.controller.select("DARK");
  await f.controller.sync();
  expect(f.data.has(pendingThemeKey)).toBe(true);
  expect(f.status).toHaveBeenLastCalledWith("retry");
  await f.controller.sync();
  expect(f.data.has(pendingThemeKey)).toBe(false);
  expect(f.status).toHaveBeenLastCalledWith("saved");
});
test("guest themes remain local and a pending choice for one account is not saved to another", async () => {
  const guest = fixture({ fetchUser: async () => response({}, 401) });
  guest.controller.select("LIGHT");
  await guest.controller.sync();
  expect(guest.save).not.toHaveBeenCalled();
  expect(guest.data.get("durak-theme")).toBe("light");
  expect(guest.data.has(pendingThemeKey)).toBe(false);
  const f = fixture({ cachedAccount: () => ({ id: "old" }), fetchUser: async () => response({ user: user("CLASSIC", 0, "new") }) });
  f.controller.select("DARK");
  await f.controller.sync();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.apply).toHaveBeenLastCalledWith("classic");
});
test("a stale account read cannot undo a choice completed by another page", async () => {
  const delayed = deferred();
  const f = fixture();
  f.data.set("durak-theme", "dark");
  f.data.set(pendingThemeKey, JSON.stringify({ id: "pending", theme: "dark", userId: "1" }));
  const other = fixture({ storage: f.storage, fetchUser: () => delayed.promise });
  const done = other.controller.sync();
  f.data.delete(pendingThemeKey);
  delayed.resolve(response({ user: user("LIGHT") }));
  await done;
  expect(other.apply).toHaveBeenLastCalledWith("dark");
});
test("logout or switching accounts during a read ignores the previous account response", async () => {
  const read = deferred();
  const f = fixture({ fetchUser: () => read.promise });
  const done = f.controller.sync();
  f.controller.accountChanged(user("DARK", 4, "new"));
  read.resolve(response({ user: user("LIGHT", 0, "old") }));
  await done;
  expect(f.apply).toHaveBeenLastCalledWith("dark");
});
test("blocked storage does not stop theme selection or saving", async () => {
  const blocked = () => { throw new Error("storage blocked"); };
  const f = fixture({ storage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
  f.controller.select("DARK");
  await f.controller.sync();
  expect(f.apply).toHaveBeenLastCalledWith("dark");
  expect(f.save).toHaveBeenCalledWith("DARK", 0);
});

test("theme selection also works on a LAN HTTP origin without randomUUID", async () => {
  vi.stubGlobal("crypto", {});
  try {
    const f = fixture();
    expect(f.controller.select("DARK")).toBe(true);
    await f.controller.sync();
    expect(f.save).toHaveBeenCalledWith("DARK", 0);
  } finally { vi.unstubAllGlobals(); }
});

test("modern theme restores from an account and guests can keep it locally", async () => {
  const f = fixture({ fetchUser: async () => response({ user: user("MODERN", 3) }) });
  await f.controller.sync();
  expect(f.apply).toHaveBeenLastCalledWith("modern");
  expect(f.data.get("durak-theme")).toBe("modern");
  const guest = fixture({ fetchUser: async () => response({}, 401) });
  guest.controller.select("MODERN");
  await guest.controller.sync();
  expect(guest.data.get("durak-theme")).toBe("modern");
  expect(guest.save).not.toHaveBeenCalled();
});
