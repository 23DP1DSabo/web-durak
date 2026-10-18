import { prisma } from "./lib/prisma.js";

async function main() {
  // Read-only schema check; do not seed shared databases with demo accounts.
  console.log({
    users: await prisma.user.count(),
    friendships: await prisma.friendship.count(),
    matches: await prisma.match.count(),
    matchPlayers: await prisma.matchPlayer.count(),
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
