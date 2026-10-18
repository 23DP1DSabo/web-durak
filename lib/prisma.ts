import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

if (!process.env.DATABASE_URL) {
  throw new Error("Iestatiet DATABASE_URL projekta .env failā.");
}
// Share the connection string with prisma.config.ts so migrations and the API
// always use the same database, locally or on Railway.
const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

export { prisma };
