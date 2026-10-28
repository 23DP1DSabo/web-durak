// Measures real MySQL lobby creation; removes only rooms created by this run.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createAuthApp } from "../app.js";
import { prisma } from "../lib/prisma.ts";
const server = createServer(createAuthApp(prisma));
const ownCodes = [];
const timings = [];
try {
  await prisma.$connect();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/rooms`;
  for (let i = 0; i < 3; i++) {
    const code = "L" + randomBytes(4).toString("hex").slice(0, 7).toUpperCase();
    const body = JSON.stringify({ code, mode: "classic", name: "Lobby performance QA", allowGuests: true });
    const started = performance.now();
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (response.status === 201) ownCodes.push(code);
    const data = await response.json();
    assert.equal(response.status, 201, data.error);
    timings.push(Math.round(performance.now() - started));
    assert.equal(data.room.players.length, 1);
    assert.equal(data.room.selfId, data.room.hostId);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const repeated = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).room.players.length, 1);
    const stranger = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(stranger.status, 403);
  }
  console.log(JSON.stringify({ label: process.env.DURAK_LOBBY_LABEL || "current", createMs: timings,
    medianMs: [...timings].sort((a,b)=>a-b)[1] }));
  console.log("PASS: durable room creation, idempotent retry, collision rejects another host");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  try {
    if (ownCodes.length) await prisma.match.deleteMany({ where: { roomCode: { in: ownCodes } } });
  } finally { await prisma.$disconnect(); }
}
