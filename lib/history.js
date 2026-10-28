// Call inside the transaction that commits the server-owned final game state.
export async function archiveRound(db, room, game, endedAt) {
  if (!game.result || !room.startedAt) return;
  const losers = game.result.losers ?? [game.result.loser].filter((id) => id != null);
  const ids = new Set(game.players.map((player) => player.id));
  const players = room.players.filter((player) => ids.has(String(player.id)));
  await db.matchRound.upsert({
    where: { matchId_startedAt: { matchId: room.id, startedAt: room.startedAt } },
    update: {},
    create: {
      matchId: room.id, mode: room.mode, startedAt: room.startedAt, endedAt,
      reason: game.result.reason || "finished",
      players: { create: players.map((player) => ({
        userId: player.userId,
        guestName: player.userId === null ? player.guestName : null,
        result: losers.includes(String(player.id)) ? "DURAK" : losers.length ? "WIN" : "DRAW",
      })) },
    },
  });
}
