/**
 * ST-183. Export analyzed tournament games as standard annotated PGN.
 *
 * Serializes stored `game`, `move_ply`, and `mistake` rows into standard PGN carrying
 * NAG glyphs ($1, $2, $4, $6), [%eval] centipawn evaluations, [%clk] remaining time,
 * and engine mistake commentary. Can be opened in ChessBase, Lichess, or any standard
 * chess software.
 */
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { exportGamePgn, exportTournamentPgn } from '../contract/routes.ts';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly, tournament } from '../db/schema.ts';
import { readSession } from '../session.ts';
import { hasPlayerClaim } from '../players/claim.ts';
import { HUMAN_LABELS } from '../analysis/leak.ts';

type Db = PostgresJsDatabase<typeof schema>;
type GameRow = typeof game.$inferSelect;
type MovePlyRow = typeof movePly.$inferSelect;
type MistakeRow = typeof mistake.$inferSelect;

function formatPgnDate(date: Date | null): string {
  if (!date) return '????.??.??';
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function wrapTokens(tokens: string[], maxLen = 80): string {
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (!current) {
      current = token;
    } else if (current.length + 1 + token.length <= maxLen) {
      current += ' ' + token;
    } else {
      lines.push(current);
      current = token;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

/**
 * Serialize a single game with its plies and mistakes into standard annotated PGN.
 */
export function serializeGameToAnnotatedPgn(
  gameRow: GameRow,
  plies: MovePlyRow[],
  mistakes: MistakeRow[],
): string {
  const headers: [string, string][] = [
    ['Event', gameRow.event ?? 'Casual Game'],
    ['Site', gameRow.site ?? 'Kanso Chess'],
    ['Date', formatPgnDate(gameRow.playedAt)],
    ['Round', gameRow.round != null ? String(gameRow.round) : '-'],
    ['White', gameRow.whiteName ?? 'White'],
    ['Black', gameRow.blackName ?? 'Black'],
    ['Result', gameRow.result],
  ];

  if (gameRow.eco) headers.push(['ECO', gameRow.eco]);
  if (gameRow.whiteElo != null) headers.push(['WhiteElo', String(gameRow.whiteElo)]);
  if (gameRow.blackElo != null) headers.push(['BlackElo', String(gameRow.blackElo)]);
  if (gameRow.timeControl) headers.push(['TimeControl', gameRow.timeControl]);

  const headerText = headers.map(([k, v]) => `[${k} "${v}"]`).join('\n');

  if (plies.length === 0) {
    const rawMoves = gameRow.pgn.replace(/\[.*?\]\s*/g, '').trim();
    return `${headerText}\n\n${rawMoves || gameRow.result}`;
  }

  const mistakesByPly = new Map<number, MistakeRow>();
  for (const m of mistakes) {
    mistakesByPly.set(m.ply, m);
  }

  const tokens: string[] = [];

  for (const ply of plies) {
    const isWhite = ply.ply % 2 === 1;
    const moveNumber = Math.floor((ply.ply + 1) / 2);

    if (isWhite) {
      tokens.push(`${moveNumber}.`);
      tokens.push(ply.san);
    } else if (tokens.length === 0) {
      tokens.push(`${moveNumber}...`);
      tokens.push(ply.san);
    } else {
      tokens.push(ply.san);
    }

    const mistakeRow = mistakesByPly.get(ply.ply);
    if (mistakeRow) {
      switch (mistakeRow.judgement) {
        case 'blunder':
          tokens.push('$4');
          break;
        case 'mistake':
          tokens.push('$2');
          break;
        case 'inaccuracy':
          tokens.push('$6');
          break;
      }
    }

    const comments: string[] = [];
    if (ply.evalMate != null) {
      comments.push(`[%eval #${ply.evalMate}]`);
    } else if (ply.evalCp != null) {
      const pawns = (ply.evalCp / 100).toFixed(2);
      const sign = ply.evalCp >= 0 ? '+' : '';
      comments.push(`[%eval ${sign}${pawns}]`);
    }

    if (ply.clockMs != null) {
      const totalSec = Math.max(0, Math.floor(ply.clockMs / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      comments.push(
        `[%clk ${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}]`,
      );
    }

    if (mistakeRow) {
      const motifLabel = mistakeRow.motif
        ? (HUMAN_LABELS[mistakeRow.motif] ?? mistakeRow.motif)
        : 'Mistake';
      const cpLossPawns = (mistakeRow.cpLoss / 100).toFixed(2);
      comments.push(
        `Mistake: ${motifLabel}. Best was ${mistakeRow.bestMoveSan} (-${cpLossPawns}).`,
      );
    }

    if (comments.length > 0) {
      tokens.push(`{ ${comments.join(' ')} }`);
    }
  }

  tokens.push(gameRow.result);

  return `${headerText}\n\n${wrapTokens(tokens)}`;
}

export function mountExportGamePgn(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(exportGamePgn, async (c) => {
    const { gameId } = c.req.valid('param');
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [row] = await deps.db.select().from(game).where(eq(game.id, gameId)).limit(1);
    if (!row) {
      return c.json({ code: 'not_found', message: 'No such game.' }, 404);
    }
    if (!(await hasPlayerClaim(deps.db, session.userId, row.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your game.' }, 403);
    }

    const [plies, mistakes] = await Promise.all([
      deps.db.select().from(movePly).where(eq(movePly.gameId, gameId)).orderBy(asc(movePly.ply)),
      deps.db.select().from(mistake).where(eq(mistake.gameId, gameId)).orderBy(asc(mistake.ply)),
    ]);

    const pgnText = serializeGameToAnnotatedPgn(row, plies, mistakes);
    const filename = `${(row.whiteName || 'White').replace(/\s+/g, '_')}_vs_${(row.blackName || 'Black').replace(/\s+/g, '_')}.pgn`;
    return c.text(pgnText, 200, {
      'Content-Type': 'application/x-chess-pgn',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  });
}

export function mountExportTournamentPgn(
  app: OpenAPIHono,
  deps: { db: Db; getSession: (c: Context) => unknown },
): void {
  app.openapi(exportTournamentPgn, async (c) => {
    const { tournamentId } = c.req.valid('param');
    const session = await readSession(deps.getSession, c);
    if (session === null) {
      return c.json({ code: 'no_session', message: 'Sign in to use this endpoint.' }, 401);
    }

    const [tourn] = await deps.db
      .select()
      .from(tournament)
      .where(eq(tournament.id, tournamentId))
      .limit(1);
    if (!tourn || !(await hasPlayerClaim(deps.db, session.userId, tourn.playerId))) {
      return c.json({ code: 'forbidden', message: 'Not your tournament.' }, 403);
    }

    const games = await deps.db
      .select()
      .from(game)
      .where(eq(game.tournamentId, tournamentId))
      .orderBy(asc(game.round), asc(game.board), asc(game.playedAt));

    const gameIds = games.map((g) => g.id);
    let allPlies: MovePlyRow[] = [];
    let allMistakes: MistakeRow[] = [];
    if (gameIds.length > 0) {
      [allPlies, allMistakes] = await Promise.all([
        deps.db
          .select()
          .from(movePly)
          .where(inArray(movePly.gameId, gameIds))
          .orderBy(asc(movePly.ply)),
        deps.db
          .select()
          .from(mistake)
          .where(inArray(mistake.gameId, gameIds))
          .orderBy(asc(mistake.ply)),
      ]);
    }

    const pliesByGame = new Map<string, MovePlyRow[]>();
    for (const p of allPlies) {
      const list = pliesByGame.get(p.gameId) ?? [];
      list.push(p);
      pliesByGame.set(p.gameId, list);
    }

    const mistakesByGame = new Map<string, MistakeRow[]>();
    for (const m of allMistakes) {
      const list = mistakesByGame.get(m.gameId) ?? [];
      list.push(m);
      mistakesByGame.set(m.gameId, list);
    }

    const gamePgns = games.map((g) =>
      serializeGameToAnnotatedPgn(g, pliesByGame.get(g.id) ?? [], mistakesByGame.get(g.id) ?? []),
    );
    const pgnText = gamePgns.join('\n\n') + '\n';
    const filename = `${(tourn.name || 'tournament').replace(/[^a-zA-Z0-9_-]/g, '_')}.pgn`;
    return c.text(pgnText, 200, {
      'Content-Type': 'application/x-chess-pgn',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  });
}
