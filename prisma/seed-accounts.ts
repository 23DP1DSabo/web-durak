import { randomBytes, randomInt, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "../lib/prisma.js";

// Fills a LOCAL database with test accounts:  npm run db:seed-accounts -- 30
// Removes them again:                         npm run db:seed-accounts -- --remove
// Seeded accounts share the password below and an @seed.duraklash.test e-mail,
// which is how --remove finds them. Never run this against the shared database.
const domain = "seed.duraklash.test";
const password = "parole123";
const names = [
  "Jānis", "Pēteris", "Andris", "Mārtiņš", "Kristaps", "Edgars", "Roberts", "Artūrs",
  "Dāvis", "Rihards", "Anna", "Laura", "Elīna", "Līga", "Ilze", "Kristīne", "Zane",
  "Marta", "Evija", "Agnese", "Sanita", "Rūta", "Daiga", "Toms", "Oskars",
];
const days = 24 * 60 * 60 * 1000;
const pick = <T>(items: T[]) => items[randomInt(items.length)];
const ago = (maxMs: number) => new Date(Date.now() - randomInt(maxMs));

const host = new URL(process.env.DATABASE_URL!).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`Atteikts: DATABASE_URL norāda uz ${host}, nevis lokālu datubāzi.`);
  process.exit(1);
}

// Same format as hashPassword in app.js, so these accounts can log in.
async function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await promisify(scrypt)(value, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

async function seed(count: number) {
  const passwordHash = await hashPassword(password);
  const accounts = new Map<string, string>();
  while (accounts.size < count) {
    const name = pick(names);
    const ascii = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    accounts.set(`${ascii}_${randomInt(10, 10000)}`, name);
  }
  const result = await prisma.user.createMany({
    skipDuplicates: true,
    data: [...accounts].map(([username, name]) => {
      const banned = randomInt(10) === 0;
      return {
        username,
        email: `${username}@${domain}`,
        name,
        passwordHash,
        theme: pick(["CLASSIC", "LIGHT", "DARK", "MODERN"] as const),
        status: banned ? "BANNED" as const : "ACTIVE" as const,
        banExpiresAt: banned && randomInt(2) ? new Date(Date.now() + randomInt(1, 30) * days) : null,
        createdAt: ago(90 * days),
        lastLoginAt: randomInt(5) === 0 ? null : ago(30 * days),
      };
    }),
  });
  console.log(`Izveidoti ${result.count} konti (@${domain}), parole: ${password}`);
}

async function remove() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${domain}` } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  await prisma.$transaction([
    prisma.friendship.deleteMany({
      where: { OR: [{ senderId: { in: ids } }, { recipientId: { in: ids } }] },
    }),
    prisma.matchPlayer.updateMany({
      where: { userId: { in: ids } },
      data: { userId: null, guestName: "Dzēsts lietotājs" },
    }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`Dzēsti ${ids.length} testa konti.`);
}

const argument = process.argv[2];
try {
  if (argument === "--remove") await remove();
  else {
    const count = Number(argument ?? 30);
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Norādi skaitu no 1 līdz 1000.");
    await seed(count);
  }
} finally {
  await prisma.$disconnect();
}
