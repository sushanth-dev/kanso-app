/**
 * ST-098. The places behind a weakness: up to three mistake rows per weakness
 * group, plus one line of advice per group.
 *
 * The instances are drawn from the same `mistake` rows, the same window, and
 * the same rated-game scope the leak aggregates summed ({@link leakScope}), so
 * the places a report shows can never disagree with the number it claims. The
 * advice is static copy: per-instance, the engine's stored best move is the
 * concrete fix, and a model call here would be ADR-0018's job, not a report's.
 */
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { game, mistake, movePly } from '../db/schema.ts';
import { leakScope, severityWeightSql, type WeaknessKind } from '../analysis/leak.ts';
import { TROUBLE_CLOCK_MS } from '../phases/phases.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Stream = (typeof schema.streamEnum.enumValues)[number];
type Phase = (typeof schema.phaseEnum.enumValues)[number];
type Judgement = (typeof schema.judgementEnum.enumValues)[number];

/** One weakness group to gather evidence for, keyed as the aggregate was. */
export interface EvidenceGroup {
  kind: WeaknessKind;
  key: string;
}

/** One place a weakness was found: the mistake row and its game's names. */
export interface EvidenceInstance {
  gameId: string;
  whiteName: string | null;
  blackName: string | null;
  playedAt: string | null;
  moveNumber: number;
  ply: number;
  moveSan: string;
  bestMoveSan: string;
  phase: Phase | null;
  judgement: Judgement;
  cpLoss: number;
}

/** The rows the queries return: an instance's fields, before serialisation. */
interface EvidenceRow {
  gameId: string;
  whiteName: string | null;
  blackName: string | null;
  playedAt: Date | null;
  moveNumber: number;
  ply: number;
  moveSan: string;
  bestMoveSan: string;
  phase: Phase | null;
  judgement: Judgement;
  cpLoss: number;
  groupKey: string | null;
}

const EVIDENCE_PER_GROUP = 3;
// A season of mistakes is hundreds of rows; a safety ceiling, not a working
// number. ponytail: per-group capping happens in JS over these rows; a window
// function would push it into SQL if a scope ever outgrows this.
const ROW_CEILING = 500;

/**
 * Recover a weakness group's aggregate key from a stored weakness row, whose
 * columns keep the display label but not the key. The labels are the ones
 * `leak.ts` humanized with, so the inverse is exact for anything this code
 * wrote; an unknown label yields null and the weakness simply carries no
 * evidence rather than a guess.
 */
const LABEL_KEYS: Record<string, string> = {
  'Hanging piece': 'hanging_piece',
  'Missed check': 'missed_check',
  'Missed capture': 'missed_capture',
  'Missed threat': 'missed_threat',
  Middlegame: 'middlegame',
  Endgame: 'endgame',
  Opening: 'opening',
};

export function groupKeyOf(kind: WeaknessKind, label: string, eco: string | null): string | null {
  switch (kind) {
    case 'opening':
      return eco;
    case 'time_trouble':
      return 'time_trouble';
    case 'motif':
    case 'phase':
      return LABEL_KEYS[label] ?? null;
  }
}

/**
 * Worst first: the half-points the leak counted, then the raw centipawn drop,
 * each opponent-weighted by ST-149's severity so the same evidence order the
 * leak ranked with is the order shown beneath it.
 */
const worstFirst = [
  desc(sql`${severityWeightSql} * ${mistake.halfPointsLost}`),
  desc(sql`${severityWeightSql} * ${mistake.cpLoss}`),
];

function toInstance(r: EvidenceRow): EvidenceInstance {
  return {
    gameId: r.gameId,
    whiteName: r.whiteName,
    blackName: r.blackName,
    playedAt: r.playedAt?.toISOString() ?? null,
    moveNumber: r.moveNumber,
    ply: r.ply,
    moveSan: r.moveSan,
    bestMoveSan: r.bestMoveSan,
    phase: r.phase,
    judgement: r.judgement,
    cpLoss: r.cpLoss,
  };
}

/**
 * The evidence instances per weakness group, keyed `kind:key`, worst first,
 * at most three per group. Opening weaknesses have no instances: their
 * evidence is the set of games in that ECO, which the games page already
 * lists.
 */
export async function weaknessEvidence(
  db: Db,
  playerId: string,
  stream: Stream,
  tournamentId: string | undefined,
  windowStart: Date | null,
  groups: EvidenceGroup[],
): Promise<Map<string, EvidenceInstance[]>> {
  const result = new Map<string, EvidenceInstance[]>();
  if (windowStart === null || groups.length === 0) return result;

  const motifKeys = groups.filter((g) => g.kind === 'motif').map((g) => g.key);
  const phaseKeys: Phase[] = groups.filter((g) => g.kind === 'phase').map((g) => g.key as Phase);
  const wantsTrouble = groups.some((g) => g.kind === 'time_trouble');
  const scope = leakScope(playerId, stream, windowStart, tournamentId);

  const instanceSelect = (groupKey: typeof mistake.motif | typeof mistake.phase) =>
    db
      .select({
        gameId: mistake.gameId,
        whiteName: game.whiteName,
        blackName: game.blackName,
        playedAt: game.playedAt,
        moveNumber: mistake.moveNumber,
        ply: mistake.ply,
        moveSan: mistake.moveSan,
        bestMoveSan: mistake.bestMoveSan,
        phase: mistake.phase,
        judgement: mistake.judgement,
        cpLoss: mistake.cpLoss,
        groupKey,
      })
      .from(mistake)
      .innerJoin(game, eq(mistake.gameId, game.id));

  const rows: EvidenceRow[] = [];
  if (motifKeys.length > 0) {
    rows.push(
      ...(await instanceSelect(mistake.motif)
        .where(and(scope, inArray(mistake.motif, motifKeys)))
        .orderBy(...worstFirst)
        .limit(ROW_CEILING)),
    );
  }
  if (phaseKeys.length > 0) {
    rows.push(
      ...(await instanceSelect(mistake.phase)
        .where(and(scope, inArray(mistake.phase, phaseKeys)))
        .orderBy(...worstFirst)
        .limit(ROW_CEILING)),
    );
  }
  if (wantsTrouble) {
    const troubleRows = await db
      .select({
        gameId: mistake.gameId,
        whiteName: game.whiteName,
        blackName: game.blackName,
        playedAt: game.playedAt,
        moveNumber: mistake.moveNumber,
        ply: mistake.ply,
        moveSan: mistake.moveSan,
        bestMoveSan: mistake.bestMoveSan,
        phase: mistake.phase,
        judgement: mistake.judgement,
        cpLoss: mistake.cpLoss,
      })
      .from(mistake)
      .innerJoin(game, eq(mistake.gameId, game.id))
      .innerJoin(movePly, and(eq(movePly.gameId, mistake.gameId), eq(movePly.ply, mistake.ply)))
      .where(and(scope, lte(movePly.clockMs, TROUBLE_CLOCK_MS)))
      .orderBy(...worstFirst)
      .limit(ROW_CEILING);
    for (const r of troubleRows) rows.push({ ...r, groupKey: 'time_trouble' });
  }

  for (const g of groups) {
    if (g.kind === 'opening') continue;
    result.set(
      `${g.kind}:${g.key}`,
      rows
        .filter((r) => r.groupKey === g.key)
        .slice(0, EVIDENCE_PER_GROUP)
        .map((r) => toInstance(r)),
    );
  }
  return result;
}

/**
 * One line of advice per weakness group; null where no honest line exists.
 * Phase advice names the move stretch the evidence actually clusters in, so
 * the copy can never contradict the instances shown beneath it.
 */
export function adviceFor(
  kind: WeaknessKind,
  key: string,
  evidence: EvidenceInstance[] = [],
): string | null {
  switch (kind) {
    case 'opening':
      return null;
    case 'motif':
      return MOTIF_ADVICE[key] ?? GENERIC_ADVICE;
    case 'phase':
      return phaseAdvice(key, evidence);
    case 'time_trouble':
      return TIME_TROUBLE_ADVICE;
  }
}

function phaseAdvice(key: string, evidence: EvidenceInstance[]): string {
  const body = PHASE_ADVICE[key];
  if (!body) return GENERIC_ADVICE;
  const moves = evidence.map((e) => e.moveNumber).filter((n) => Number.isFinite(n));
  if (key !== 'middlegame' || moves.length === 0) {
    return key === 'middlegame' ? `Slow down before committing to a move: ${body}` : body;
  }
  const from = Math.min(...moves);
  const to = Math.max(...moves);
  const stretch = from === to ? `around move ${from}` : `in the move ${from}-${to} stretch`;
  return `Slow down ${stretch}: ${body}`;
}

const GENERIC_ADVICE =
  'Play through the positions listed here once until the pattern is familiar; ' +
  'repetition, not talent, is what fixes tactics.';

const MOTIF_ADVICE: Record<string, string> = {
  hanging_piece:
    'Before each move, ask what your opponent’s last move attacks - and after ' +
    'choosing one, check it does not leave the moved piece, or anything it was ' +
    'guarding, undefended.',
  missed_check:
    'Scan checks first: before committing to a move, list every check you can ' +
    'give and ask what each one forces.',
  missed_capture:
    'After every opponent move, count what each available capture wins or ' +
    'recovers; the capture hidden behind a defender is the one that gets missed.',
};

const PHASE_ADVICE: Record<string, string> = {
  opening:
    'In the opening, prioritise development and king safety over material; a ' +
    'lead in development is what converts the middlegame.',
  // The middlegame head ("Slow down …") is derived from the evidence in
  // phaseAdvice; the copy here carries only the routine.
  middlegame:
    'pick a candidate move, test it against checks, captures and threats, ' +
    'and only then play it.',
  endgame:
    'Convert with a plan: activate the king, push passed pawns, and calculate ' +
    'concretely before each move - endgame mistakes are the least recoverable.',
};

const TIME_TROUBLE_ADVICE =
  'Budget the clock: pre-decide the routine moves so the time is spent on the ' +
  'critical ones, and aim to reach the time control with moves to spare.';
