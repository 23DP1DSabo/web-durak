import { expect, test } from "vitest";
import { createPresence } from "../lib/presence.js";

test("a session is online until no request arrives within the window", () => {
  const presence = createPresence({ windowMs: 1000 });
  expect(presence.isOnline("session", 0)).toBe(false);
  presence.touch("session", 0);
  expect(presence.isOnline("session", 999)).toBe(true);
  expect(presence.isOnline("session", 1000)).toBe(false);
  presence.touch("session", 1500);
  expect(presence.isOnline("session", 2000)).toBe(true);
  expect(presence.isOnline("other", 2000)).toBe(false);
});
