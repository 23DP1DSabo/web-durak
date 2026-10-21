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
  minimumIdle: "1",
  connectionLimit: "5",
  keepAliveDelay: "10000",
};
for (const [name, value] of Object.entries(poolDefaults)) {
  if (!databaseUrl.searchParams.has(name))
    databaseUrl.searchParams.set(name, value);
}
const adapter = new PrismaMariaDb(databaseUrl.toString());
const prisma = new PrismaClient({ adapter });

export { prisma };
