import { expect, test } from "vitest";
import { createInvites, publicInvite } from "../lib/invites.js";

test("invitations expire and can only be answered once by their recipient", () => {
  const invites = createInvites({ ttlMs: 1000 });
  const data = { roomCode: "ROOM1234", mode: "classic", fromUserId: 1n, fromName: "anna", toUserId: 2n, toName: "bob" };
  const invite = invites.create(data, 0);
  expect(publicInvite(invite, 250)).toEqual({
    id: invite.id, roomCode: "ROOM1234", mode: "classic", fromName: "anna", expiresInMs: 750,
  });
  expect(() => invites.create(data, 500)).toThrow("jau ir nosūtīts");
  expect(() => invites.take(invite.id, 1n, 500)).toThrow("vairs nav spēkā");
  expect(invites.forUser(2n, 999)).toHaveLength(1);
  expect(invites.forUser(2n, 1000)).toEqual([]);
  expect(() => invites.take(invite.id, 2n, 1000)).toThrow("vairs nav spēkā");
  // An expired invitation no longer blocks a new one.
  expect(invites.take(invites.create(data, 1000).id, 2n, 1001).toName).toBe("bob");
});
