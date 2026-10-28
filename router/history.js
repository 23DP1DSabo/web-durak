import { Router } from "express";

export function createHistoryRouter(prisma, { getAuthenticatedUser }) {
  const router = Router();
  const route = (path, handler) => router.get(path, async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req, res);
      if (user) await handler(req, res, user);
    } catch (error) {
      console.error("Match history lookup failed:", error);
      res.status(500).json({ error: "Neizdevās ielādēt spēļu datus. Mēģini vēlreiz." });
    }
  });
  route("/statistics", async (req, res, user) => {
    const groups = await prisma.roundPlayer.groupBy({
      by: ["result"], where: { userId: user.id }, _count: { _all: true },
    });
    const counts = Object.fromEntries(groups.map((group) => [group.result, group._count._all]));
    const wins = counts.WIN || 0, losses = counts.DURAK || 0, draws = counts.DRAW || 0;
    const total = wins + losses + draws;
    res.json({ statistics: { total, wins, losses, draws, winRate: total ? Math.round(wins / total * 100) : 0 } });
  });
  route("/history", async (req, res, user) => {
    const cursor = req.query.before;
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[1-9]\d{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n)) {
      return res.status(400).json({ error: "Nederīgs vēstures lapas numurs." });
    }
    const entries = await prisma.roundPlayer.findMany({
      where: { userId: user.id, ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
      orderBy: { id: "desc" }, take: 21,
      select: {
        id: true, result: true,
        round: { select: {
          mode: true, startedAt: true, endedAt: true, reason: true,
          players: { orderBy: { id: "asc" }, select: {
            id: true, guestName: true, result: true,
            user: { select: { username: true } },
          } },
        } },
      },
    });
    const page = entries.slice(0, 20);
    res.json({
      games: page.map(({ id, result, round }) => ({
        id: String(id), result, mode: round.mode,
        startedAt: round.startedAt, endedAt: round.endedAt,
        durationSeconds: Math.max(0, Math.round((round.endedAt - round.startedAt) / 1000)),
        reason: round.reason,
        players: round.players.map((player) => ({
          name: player.user?.username || player.guestName || "Dzēsts lietotājs",
          result: player.result, isSelf: player.id === id,
        })),
      })),
      nextCursor: entries.length > 20 ? String(page.at(-1).id) : null,
    });
  });
  return router;
}
