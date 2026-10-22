import { Server } from "socket.io";
import { actor } from "./multiplayer.js";
import { allowedOrigins } from "./origins.js";

export function attachRealtime(
  httpServer,
  matches,
  {
    origin = process.env.APP_ORIGIN || "http://localhost:3000",
    tickMs = 1000,
  } = {},
) {
  const origins = allowedOrigins(origin, "http://localhost:3000");
  const io = new Server(httpServer, {
    maxHttpBufferSize: 4096,
    allowRequest: (req, done) =>
      done(
        null,
        (typeof req.headers.origin === "string" &&
          origins.has(req.headers.origin)) ||
          (!req.headers.origin &&
            req.headers["sec-fetch-site"] !== "cross-site"),
      ),
  });
  const subscriptions = new Map();
  const latestRooms = new Map();
  const clocks = new Map();
  let disposed = false;
  function scheduleClock(room) {
    if (disposed) return;
    const code = room.roomCode;
    const previous = clocks.get(code);
    if (previous && previous.version > room.version) return;
    const game = room.gameState;
    const turn =
      game && !game.result
        ? game.players.find((p) => p.id === actor(game))
        : null;
    const deadline = turn ? game.updatedAt + turn.remainingMs : null;
    if (
      previous &&
      previous.deadline === deadline &&
      previous.version === room.version
    )
      return;
    if (previous) clearTimeout(previous.timer);
    clocks.delete(code);
    if (deadline === null || room.status === "FINISHED") return;
    const timer = setTimeout(
      () => void checkDeadline(code),
      Math.max(10, Math.min(2147483647, deadline - Date.now())),
    );
    timer.unref();
    clocks.set(code, { timer, deadline, version: room.version });
  }
  async function checkDeadline(code) {
    const previous = clocks.get(code);
    clocks.delete(code);
    if (disposed) return;
    try {
      scheduleClock(await matches.expireRoom(code));
    } catch (error) {
      // Another committed move may already have installed its next deadline.
      if (!disposed && !clocks.has(code) && error.status !== 404) {
        const timer = setTimeout(() => void checkDeadline(code), 5000);
        timer.unref();
        clocks.set(code, { ...previous, timer });
      }
      if (!error.status)
        console.error("Game clock retry:", error.code || error.message);
    }
  }
  const safeError = (error) =>
    error.status ? error.message : "Servera kļūda. Mēģini vēlreiz.";
  async function snapshot(socket, room) {
    const identity = await matches.identity(socket.request);
    return matches.view(room, identity);
  }
  async function publish(code, committedRoom) {
    const sockets = [...io.sockets.sockets.values()].filter(
      (s) => subscriptions.get(s.id) === code,
    );
    if (!sockets.length) return;
    let room =
      committedRoom || latestRooms.get(code) || (await matches.load(code));
    const previous = latestRooms.get(code);
    if (previous && previous.version > room.version) room = previous;
    latestRooms.set(code, room);
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          socket.emit("game:state", await snapshot(socket, room));
        } catch (e) {
          socket.emit("game:error", safeError(e));
          if ([401, 403, 404].includes(e.status)) {
            subscriptions.delete(socket.id);
            socket.disconnect(true);
          }
        }
      }),
    );
  }
  const changed = (code, room) => {
    if (room) scheduleClock(room);
    void publish(code, room).catch((e) =>
      console.error("Game broadcast:", e.code || e.message),
    );
  };
  matches.events.on("changed", changed);
  io.on("connection", (socket) => {
    let busy = false,
      count = 0,
      windowStart = Date.now();
    function handle(event, fn) {
      socket.on(event, async (data, ack) => {
        if (typeof ack !== "function") return;
        if (Date.now() - windowStart > 10000) {
          count = 0;
          windowStart = Date.now();
        }
        if (busy || ++count > 40)
          return ack({ error: "Pagaidi iepriekšējās darbības pabeigšanu." });
        busy = true;
        try {
          ack(await fn(data));
        } catch (e) {
          ack({ error: safeError(e), status: e.status || 500 });
        } finally {
          busy = false;
        }
      });
    }
    handle("game:join", async (data) => {
      const code =
        typeof data?.code === "string" ? data.code.toUpperCase() : "";
      const room = await matches.load(code);
      const game = await snapshot(socket, room);
      const oldCode = subscriptions.get(socket.id);
      subscriptions.set(socket.id, code);
      if (
        oldCode &&
        oldCode !== code &&
        ![...subscriptions.values()].includes(oldCode)
      )
        latestRooms.delete(oldCode);
      if (
        !latestRooms.has(code) ||
        latestRooms.get(code).version <= room.version
      )
        latestRooms.set(code, room);
      scheduleClock(room);
      return { game };
    });
    handle("game:move", async (data) => {
      const code = subscriptions.get(socket.id);
      if (!code) return { error: "Vispirms pievienojies spēlei." };
      const identity = await matches.identity(socket.request);
      const room = await matches.action(
        code,
        identity,
        data?.move,
        data?.version,
        latestRooms.get(code),
      );
      return { game: matches.view(room, identity) };
    });
    socket.on("disconnect", () => {
      const code = subscriptions.get(socket.id);
      subscriptions.delete(socket.id);
      if (![...subscriptions.values()].includes(code)) latestRooms.delete(code);
    });
  });
  // Revalidate sessions without rereading unchanged game state. Each committed
  // change already carries the new snapshot and is pushed immediately.
  let checkingSessions = false,
    discovering = false;
  const timer = setInterval(
    async () => {
      if (checkingSessions || disposed) return;
      checkingSessions = true;
      try {
        await Promise.all(
          [...new Set(subscriptions.values())].map((code) => publish(code)),
        );
      } catch (error) {
        console.error("Game refresh:", error.code || error.message);
      } finally {
        checkingSessions = false;
      }
    },
    Math.max(1000, tickMs * 5),
  );
  timer.unref();
  // Recover deadlines on restart, and discover any games from another process.
  // Clock expiration itself is timer-driven, not a full DB scan every second.
  async function discover() {
    if (discovering || disposed) return;
    discovering = true;
    try {
      for (const room of await matches.activeClocks()) scheduleClock(room);
    } catch (error) {
      console.error("Game clock discovery:", error.code || error.message);
    } finally {
      discovering = false;
    }
  }
  void discover();
  const discoveryTimer = setInterval(discover, Math.max(30000, tickMs * 30));
  discoveryTimer.unref();
  const cleanup = () => {
    disposed = true;
    clearInterval(timer);
    clearInterval(discoveryTimer);
    for (const clock of clocks.values()) clearTimeout(clock.timer);
    clocks.clear();
    latestRooms.clear();
    matches.events.off("changed", changed);
  };
  httpServer.once("close", cleanup);
  return { io, cleanup };
}
