import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

if (!process.env.DATABASE_URL) {
  throw new Error("Iestatiet DATABASE_URL projekta .env failā.");
}
// Share the connection string with prisma.config.ts so migrations and the API
// always use the same database, locally or on Railway.
// The public Railway connection has WAN latency. The driver's 250ms ping
// timeout can discard healthy connections; reuse recently checked connections.
// Explicit URL options still take precedence (and credentials are never logged).
const databaseUrl = new URL(process.env.DATABASE_URL);
const poolDefaults = {
  connectTimeout: "10000",
  acquireTimeout: "15000",
  pingTimeout: "5000",
  minDelayValidation: "30000",
  minimumIdle: "2",
  // Each query holds a connection for a whole WAN round trip, so lobby polling
  // and parallel page requests queue up quickly behind a small pool.
  connectionLimit: "10",
  keepAliveDelay: "10000",
};
for (const [name, value] of Object.entries(poolDefaults)) {
  if (!databaseUrl.searchParams.has(name))
    databaseUrl.searchParams.set(name, value);
}
const adapter = new PrismaMariaDb(databaseUrl.toString());

// Every authenticated request looks up its session with the user, which costs
// a WAN round trip. Cache those lookups briefly. Any write to users or sessions
// (logout, ban, profile, theme...) empties the cache and skips it long enough
// for an enclosing transaction to commit, so this process never serves stale
// data. Changes made by another server on the same database show up within
// sessionTtlMs.
const sessionTtlMs = 10 * 1000;
const writeBypassMs = 15 * 1000; // The longest transaction timeout in use.
const sessionCache = new Map<string, { savedAt: number; session: unknown }>();
let bypassUntil = 0;
const writeOperations = new Set([
  "create", "createMany", "createManyAndReturn", "update", "updateMany",
  "updateManyAndReturn", "upsert", "delete", "deleteMany",
]);
const forgetSessions = () => {
  sessionCache.clear();
  bypassUntil = Date.now() + writeBypassMs;
};
async function invalidatingWrite(operation: string, run: () => Promise<unknown>) {
  if (!writeOperations.has(operation)) return run();
  forgetSessions();
  try {
    return await run();
  } finally {
    forgetSessions();
  }
}
const isSessionWithUser = (args: any) =>
  args && !args.select && Object.keys(args.where ?? {}).join() === "tokenHash"
  && typeof args.where.tokenHash === "string"
  && Object.keys(args.include ?? {}).join() === "user" && args.include.user === true;

const prisma = new PrismaClient({ adapter }).$extends({
  query: {
    user: {
      $allOperations: ({ operation, args, query }) => invalidatingWrite(operation, () => query(args)),
    },
    session: {
      async $allOperations({ operation, args, query }) {
        if (operation !== "findUnique" || !isSessionWithUser(args))
          return invalidatingWrite(operation, () => query(args));
        const now = Date.now();
        const key = args.where.tokenHash as string;
        const cached = sessionCache.get(key);
        // Callers reassign session.user, so never hand out the cached object.
        if (cached && now - cached.savedAt < sessionTtlMs) return structuredClone(cached.session);
        const session = await query(args);
        if (session && now >= bypassUntil && Date.now() >= bypassUntil) {
          if (sessionCache.size >= 5000) sessionCache.clear();
          sessionCache.set(key, { savedAt: now, session: structuredClone(session) });
        }
        return session;
      },
    },
  },
});

export { prisma };
