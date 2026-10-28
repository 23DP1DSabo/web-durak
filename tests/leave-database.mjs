// Real MySQL leave timings; cleans up only rooms created by this run.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createAuthApp } from "../app.js";
import { prisma } from "../lib/prisma.ts";
const server = createServer(createAuthApp(prisma));
const ownCodes = [], hostMs = [], guestMs = [];
try {
  await prisma.$connect();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  async function post(path, body, cookie) {
    const response = await fetch(base + path, { method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  for (let i = 0; i < 3; i++) {
    const code = "E" + randomBytes(4).toString("hex").slice(0, 7).toUpperCase();
    const host = await post("", { code, mode: "classic", name: "Leave QA host", allowGuests: true });
    if (host.status === 201) ownCodes.push(code);
    assert.equal(host.status, 201);
    const guest = await post(`/${code}/join`, { name: "Leave QA guest" });
    assert.equal(guest.status, 200);
    let started = performance.now();
    const left = await post(`/${code}/leave`, {}, guest.cookie);
    guestMs.push(Math.round(performance.now() - started));
    assert.equal(left.status, 200);
    assert.equal(left.body.room.players.length, 1);
    assert.equal(left.body.room.status, "waiting");
    let saved = await prisma.match.findUnique({ where: { roomCode: code }, include: { players: true } });
    assert.equal(saved.players.length, 1);
    started = performance.now();
    const closed = await post(`/${code}/leave`, {}, host.cookie);
    hostMs.push(Math.round(performance.now() - started));
    assert.equal(closed.status, 200);
    assert.equal(closed.body.room.status, "finished");
    saved = await prisma.match.findUnique({ where: { roomCode: code } });
    assert.equal(saved.status, "FINISHED");
  }
  const median = (values) => [...values].sort((a,b) => a-b)[1];
  console.log(JSON.stringify({ label: process.env.DURAK_LEAVE_LABEL || "current",
    hostMs, guestMs, hostMedianMs: median(hostMs), guestMedianMs: median(guestMs) }));
  console.log("PASS: guest membership removed and host closure persisted before response");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  try {
    if (ownCodes.length) await prisma.match.deleteMany({ where: { roomCode: { in: ownCodes } } });
  } finally { await prisma.$disconnect(); }
}
