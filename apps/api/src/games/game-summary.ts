/**
 * A stored game row in the contract's `GameSummary` shape.
 *
 * This moved out of `set-game-color.ts` when ST-005 became the second caller,
 * which was the condition its `ponytail:` note named. It is the projection the
 * list endpoint and the colour endpoint both return: game metadata, never the
 * PGN text, which is `getGame`'s job one game at a time.
 */
import type { game } from '../db/schema.ts';

export function toGameSummary(row: typeof game.$inferSelect) {
  return {
    id: row.id,
    stream: row.stream,
    source: row.source,
    playerColor: row.playerColor,
    result: row.result,
    playedAt: row.playedAt?.toISOString() ?? null,
    event: row.event,
    round: row.round,
    board: row.board,
    whiteName: row.whiteName,
    blackName: row.blackName,
    whiteElo: row.whiteElo,
    blackElo: row.blackElo,
    eco: row.eco,
    opening: row.opening,
    moveCount: row.moveCount,
    hasClockData: row.hasClockData,
    analysisStatus: row.analysisStatus,
    analyzedAt: row.analyzedAt?.toISOString() ?? null,
  };
}
