/**
 * The Zod schemas the API is defined in terms of.
 *
 * ADR-0008 makes Zod the validation layer and ADR-0013 makes these schemas the
 * single source: request validation, TypeScript types, and the OpenAPI document
 * all derive from this file, so the contract cannot drift from the
 * implementation. Nothing here is hand-mirrored anywhere else.
 */
import { z } from '@hono/zod-openapi';
import { MOTIFS } from '../analysis/motif.ts';

// ─── Primitives ──────────────────────────────────────────────────────────────

export const Uuid = z.uuid();

/** F1. The partition that runs through every aggregate in the product. */
export const Stream = z.enum(['tournament', 'online']).openapi('Stream', {
  description:
    'Tournament games and online games describe different players and are never aggregated together.',
});

export const GameSource = z.enum(['chesscom', 'lichess', 'pgn_upload']).openapi('GameSource');
export const Color = z.enum(['white', 'black']).openapi('Color');
export const GameResult = z.enum(['1-0', '0-1', '1/2-1/2', '*']).openapi('GameResult');
export const Phase = z.enum(['opening', 'middlegame', 'endgame']).openapi('Phase');
export const Judgement = z.enum(['inaccuracy', 'mistake', 'blunder']).openapi('Judgement');
export const AnalysisStatus = z
  .enum(['pending', 'queued', 'analyzing', 'complete', 'failed'])
  .openapi('AnalysisStatus');
export const JobStatus = z.enum(['queued', 'running', 'complete', 'failed']).openapi('JobStatus');
export const Tier = z.enum(['free', 'paid']).openapi('Tier');
export const WeaknessKind = z
  .enum(['opening', 'motif', 'phase', 'time_trouble'])
  .openapi('WeaknessKind');
export const FocusTrend = z
  .enum(['improving', 'flat', 'declining', 'insufficient_evidence'])
  .openapi('FocusTrend');

/**
 * Evaluations are white-absolute, in centipawns, with mate expressed as a move
 * count rather than a huge centipawn value. Exactly one of the two is set.
 */
export const Evaluation = z
  .object({
    cp: z.number().int().nullable(),
    mate: z.number().int().nullable(),
  })
  .openapi('Evaluation', { example: { cp: -240, mate: null } });

// ─── Errors ──────────────────────────────────────────────────────────────────

export const ApiError = z
  .object({
    code: z.string().openapi({ example: 'not_found' }),
    message: z.string(),
    /** Field-level detail, present only on validation failures. */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi('ApiError');

// ─── Account and player ──────────────────────────────────────────────────────

export const Player = z
  .object({
    id: Uuid,
    displayName: z.string(),
    birthYear: z.number().int().nullable(),
    fideId: z.string().nullable(),
    fideRating: z.number().int().nullable(),
    uscfId: z.string().nullable(),
    uscfRating: z.number().int().nullable(),
    chesscomUsername: z.string().nullable(),
    lichessUsername: z.string().nullable(),
    chesscomRating: z.number().int().nullable(),
    lichessRating: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi('Player');

export const CreatePlayer = z
  .object({
    displayName: z.string().min(1).max(80),
    /**
     * N7. Year rather than a full date of birth: enough to know whether COPPA
     * applies, and no more than that.
     */
    birthYear: z.number().int().min(1900).max(2100).optional(),
    fideId: z.string().max(20).optional(),
    fideRating: z.number().int().min(0).max(3500).optional(),
    uscfId: z.string().max(20).optional(),
    uscfRating: z.number().int().min(0).max(3500).optional(),
    chesscomUsername: z.string().max(60).optional(),
    lichessUsername: z.string().max(60).optional(),
  })
  .openapi('CreatePlayer');

export const UpdatePlayer = CreatePlayer.partial().openapi('UpdatePlayer');

/** B4. The paying adult, attached to the playing child. */
export const AttachGuardian = z
  .object({
    guardianEmail: z.email(),
    relationship: z.string().max(40).optional(),
  })
  .openapi('AttachGuardian');

export const Me = z
  .object({
    userId: z.string(),
    email: z.email(),
    name: z.string(),
    tier: Tier,
    /** Players this login plays as. */
    players: z.array(Player),
    /** Players this login pays for but does not play as. */
    guardedPlayers: z.array(Player),
  })
  .openapi('Me');

/** ST-018. Online rating against over-the-board, per platform. */
export const TransferGap = z
  .object({
    playerId: Uuid,
    /** FIDE when present, else USCF. */
    overTheBoardRating: z.number().int().nullable(),
    chesscom: z.object({
      rating: z.number().int().nullable(),
      gap: z.number().int().nullable(),
    }),
    lichess: z.object({
      rating: z.number().int().nullable(),
      gap: z.number().int().nullable(),
    }),
  })
  .openapi('TransferGap');

// ─── Import ──────────────────────────────────────────────────────────────────

/**
 * S1, F1. One username imports a season. A PGN upload is the same operation
 * with a different body, and both have to state their stream, because a game
 * that is not tagged at import cannot be tagged later without asking the player
 * to remember.
 */
export const StartImport = z
  .discriminatedUnion('source', [
    z.object({
      source: z.literal('chesscom'),
      username: z.string().min(1).max(60),
      stream: z.literal('online'),
      since: z.iso.date().optional(),
    }),
    z.object({
      source: z.literal('lichess'),
      username: z.string().min(1).max(60),
      stream: z.literal('online'),
      since: z.iso.date().optional(),
    }),
    z.object({
      source: z.literal('pgn_upload'),
      /** One or more games in a single PGN text. F2 rejects malformed games at this boundary. */
      pgn: z.string().min(1).max(5_000_000),
      stream: Stream,
    }),
  ])
  .openapi('StartImport');

export const ImportJob = z
  .object({
    id: Uuid,
    playerId: Uuid,
    source: GameSource,
    /** T1. A backfill and an incremental import are different work with different timeouts. */
    kind: z.enum(['backfill', 'incremental']),
    stream: Stream,
    status: JobStatus,
    gamesFound: z.number().int(),
    gamesImported: z.number().int(),
    gamesRejected: z.number().int(),
    /** F1. Games stored with no side decided; the player says which through PATCH /games/{gameId}. */
    gamesUndetermined: z.number().int(),
    error: z.string().nullable(),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .openapi('ImportJob');

// ─── Games ───────────────────────────────────────────────────────────────────

export const GameSummary = z
  .object({
    id: Uuid,
    stream: Stream,
    source: GameSource,
    playerColor: z.enum(['white', 'black']).nullable(),
    result: GameResult,
    playedAt: z.iso.datetime().nullable(),
    event: z.string().nullable(),
    round: z.number().int().nullable(),
    board: z.number().int().nullable(),
    whiteName: z.string().nullable(),
    blackName: z.string().nullable(),
    whiteElo: z.number().int().nullable(),
    blackElo: z.number().int().nullable(),
    eco: z.string().nullable(),
    opening: z.string().nullable(),
    moveCount: z.number().int().nullable(),
    hasClockData: z.boolean(),
    analysisStatus: AnalysisStatus,
    analyzedAt: z.iso.datetime().nullable(),
  })
  .openapi('GameSummary');

/**
 * F1. The player says which side of the board they were on, for a game the
 * importer could not decide. Colour is the only field: everything else on a
 * game is what the PGN said, and correcting the PGN is a re-upload.
 */
export const SetGameColor = z
  .object({
    playerColor: Color,
  })
  .openapi('SetGameColor');

export const MovePly = z
  .object({
    ply: z.number().int(),
    san: z.string(),
    uci: z.string(),
    fenBefore: z.string(),
    phase: Phase.nullable(),
    evaluation: Evaluation.nullable(),
    bestMoveSan: z.string().nullable(),
    /** F6. Online games only, and null rather than guessed everywhere else. */
    clockMs: z.number().int().nullable(),
    moveTimeMs: z.number().int().nullable(),
  })
  .openapi('MovePly');

export const Mistake = z
  .object({
    id: Uuid,
    gameId: Uuid,
    ply: z.number().int(),
    moveNumber: z.number().int(),
    movingColor: Color,
    phase: Phase.nullable(),
    fen: z.string(),
    moveSan: z.string(),
    bestMoveSan: z.string(),
    evalBefore: Evaluation,
    evalAfter: Evaluation,
    judgement: Judgement,
    cpLoss: z.number().int(),
    winProbDrop: z.number(),
    motif: z.string().nullable(),
    /** F9. Only a swing that crossed a result boundary counts toward a rating leak. */
    crossedResultBoundary: z.boolean(),
    halfPointsLost: z.number(),
    /** ADR-0018. Null until someone opens this mistake and we generate it. */
    explanation: z.string().nullable(),
  })
  .openapi('Mistake');

export const GameDetail = GameSummary.extend({
  pgn: z.string(),
  plies: z.array(MovePly),
  mistakes: z.array(Mistake),
}).openapi('GameDetail');

export const GameList = z
  .object({
    games: z.array(GameSummary),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  })
  .openapi('GameList');

// ─── Tournaments ──────────────────────────────────────────────────────────────

/**
 * S5. One tournament a player has games in, with the counts a list needs. The
 * date range is the tournament's own, from the games that formed it (ST-011),
 * not a window invented for the response.
 */
export const TournamentSummary = z
  .object({
    id: Uuid,
    name: z.string(),
    site: z.string().nullable(),
    startedAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    gameCount: z.number().int(),
    /** How many of `gameCount` have been analysed (analysisStatus complete). */
    analysedCount: z.number().int(),
  })
  .openapi('TournamentSummary');

export const TournamentList = z
  .object({
    tournaments: z.array(TournamentSummary),
  })
  .openapi('TournamentList');

/**
 * The result of one game from the player's point of view, derived from the
 * stored colour and the raw PGN result. Null when the result is unknown (`*`)
 * or the player's side was never decided.
 */
export const PlayerResult = z.enum(['win', 'draw', 'loss']).openapi('PlayerResult');

/**
 * S5. One game inside a tournament, as a player would read it: who the opponent
 * was, what the result was from their side, and whether it has been analysed.
 * `opponent` is null when the player's side is undecided, because there is no
 * way to know which name is theirs.
 */
export const TournamentGame = z
  .object({
    id: Uuid,
    round: z.number().int().nullable(),
    board: z.number().int().nullable(),
    opponent: z.string().nullable(),
    playerColor: Color.nullable(),
    result: PlayerResult.nullable(),
    analysed: z.boolean(),
  })
  .openapi('TournamentGame');

/**
 * S5. One tournament with its games in round order, then board order within a
 * round. The score is counted only from games where the player's side is known;
 * `scoreExcluded` says how many games were left out for that reason, so a score
 * over an incomplete set is a number a coach can check rather than trust.
 */
export const TournamentDetail = z
  .object({
    id: Uuid,
    name: z.string(),
    site: z.string().nullable(),
    startedAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    games: z.array(TournamentGame),
    /** Points: 1 for a win, 0.5 for a draw, 0 otherwise, over known-side games. */
    score: z.number(),
    /** How many games the score is counted over. */
    scoreGames: z.number().int(),
    /** Games left out of the score because the player's side was undecided. */
    scoreExcluded: z.number().int(),
  })
  .openapi('TournamentDetail');

/**
 * ST-019. One round of a tournament's decay line. `games` is the unique
 * complete-game count the average rests on; `mistakes` is the raw mistake row
 * count, kept separate so the join fan-out never masquerades as the game count.
 * `lossPerMove` is the average centipawn loss per player move, null when the
 * round has no moves.
 */
export const RoundDecay = z
  .object({
    round: z.number().int(),
    games: z.number().int(),
    mistakes: z.number().int(),
    lossPerMove: z.number().nullable(),
  })
  .openapi('RoundDecay');

/**
 * ST-019. A player's round-by-round evaluation loss in one tournament, with the
 * evidence count travelling with the line rather than the figure alone.
 */
export const TournamentDecay = z
  .object({
    tournamentId: Uuid,
    rounds: z.array(RoundDecay),
    /** Distinct rounds the line covers. */
    roundCount: z.number().int(),
  })
  .openapi('TournamentDecay');

// ─── Motifs ──────────────────────────────────────────────────────────────────

/**
 * ST-024. The closed set of tactical motifs a mistake can be attributed to.
 * A mistake no motif in the set explains stays null (unattributed).
 */
export const Motif = z.enum(MOTIFS).openapi('Motif', {
  description: 'A tactical motif from the closed set in analysis/motif.ts.',
});

/** One motif in the ranked report, with the evidence that supports it. */
export const MotifPoint = z
  .object({
    motif: Motif,
    /** Mistakes attributed to this motif. */
    positions: z.number().int(),
    /** Total `mistake.cp_loss` over those mistakes, the cost to the player. */
    totalCpLoss: z.number().int(),
  })
  .openapi('MotifPoint');

/**
 * ST-024. A player's missed motifs in one stream, ranked by cost. The
 * unattributed share and the withheld count travel with the list so a thin
 * history reads as thin rather than clean.
 */
export const MotifReport = z
  .object({
    playerId: Uuid,
    stream: Stream,
    motifs: z.array(MotifPoint),
    /** Mistakes no motif in the set explains. */
    unattributed: z.number().int(),
    /** Total mistakes in scope; the unattributed share is unattributed / mistakeCount. */
    mistakeCount: z.number().int(),
    /** Motifs below the reporting threshold, held back rather than reported. */
    withheld: z.number().int(),
  })
  .openapi('MotifReport');

// ─── Phase and time trouble ──────────────────────────────────────────────────

/**
 * ST-025. One phase's loss, with the number of games behind it.
 */
export const PhasePoint = z
  .object({
    phase: Phase,
    /** Total `mistake.cp_loss` in this phase. */
    totalCpLoss: z.number().int(),
    /** Games with at least one mistake in this phase. */
    games: z.number().int(),
  })
  .openapi('PhasePoint');

/**
 * ST-025. The time-trouble half, online only. `unavailable` is a first-class
 * answer rather than a null, and the reason says why there is no number.
 */
export const TimeTrouble = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('reported'),
      clockedGames: z.number().int(),
      /** Earliest full move where the player's clock was under the threshold. */
      fromMove: z.number().int(),
      troubleMoves: z.number().int(),
      /** Mistakes per move under the threshold. */
      troubleMistakeRate: z.number(),
      calmMoves: z.number().int(),
      /** Mistakes per move above the threshold. */
      calmMistakeRate: z.number(),
    }),
    z.object({
      status: z.literal('unavailable'),
      reason: z.enum(['not_online', 'no_clock_data', 'not_enough_evidence']),
    }),
  ])
  .openapi('TimeTrouble');

/**
 * ST-025. A player's evaluation loss by phase for one stream, with the
 * time-trouble half where it applies.
 */
export const PhaseReport = z
  .object({
    playerId: Uuid,
    stream: Stream,
    phases: z.array(PhasePoint),
    /** Total mistakes in scope. */
    mistakeCount: z.number().int(),
    timeTrouble: TimeTrouble,
  })
  .openapi('PhaseReport');

// ─── Report ──────────────────────────────────────────────────────────────────

/**
 * F9. The rating leak is the only number in this document that a coach will
 * argue with, so the report carries the evidence beside it rather than the
 * figure alone.
 */
export const Weakness = z
  .object({
    id: Uuid,
    kind: WeaknessKind,
    label: z.string().openapi({ example: 'Sicilian, Alapin' }),
    eco: z.string().nullable().openapi({ example: 'B22' }),
    ratingLeak: z.number().int().openapi({
      example: 34,
      description: 'Rating points this weakness costs the player over a season.',
    }),
    halfPointsLost: z.number(),
    gamesAffected: z.number().int(),
    occurrences: z.number().int(),
    rank: z.number().int(),
  })
  .openapi('Weakness');

export const Report = z
  .object({
    id: Uuid,
    playerId: Uuid,
    stream: Stream,
    generatedAt: z.iso.datetime(),
    gamesCovered: z.number().int(),
    windowStart: z.iso.datetime().nullable(),
    windowEnd: z.iso.datetime().nullable(),
    /** F6. Present on an online report, null on a tournament report by design. */
    timeTroubleFromMove: z.number().int().nullable(),
    /** S2. Ranked by cost to the player, not by recency. */
    weaknesses: z.array(Weakness),
    /** ADR-0018. Prose over the numbers above, cached against this aggregation. */
    narrative: z.string().nullable(),
  })
  .openapi('Report');

// ─── Focus ───────────────────────────────────────────────────────────────────

export const FocusCatalogueEntry = z
  .object({
    id: Uuid,
    key: z.string().openapi({ example: 'converting_won_positions' }),
    title: z.string(),
    description: z.string(),
    measureDescription: z.string(),
    /** F10. Time management is measurable on online games alone. */
    measurableStreams: z.array(Stream),
    version: z.number().int(),
  })
  .openapi('FocusCatalogueEntry');

export const FocusMeasurement = z
  .object({
    stream: Stream,
    measuredAt: z.iso.datetime(),
    /** F12, S4. How much evidence the verdict rests on. Never omitted. */
    windowGames: z.number().int(),
    baselineValue: z.number().nullable(),
    currentValue: z.number().nullable(),
    unit: z.string(),
    trend: FocusTrend,
  })
  .openapi('FocusMeasurement');

export const ActiveFocus = z
  .object({
    id: Uuid,
    source: z.enum(['recommended', 'coach', 'self']),
    catalogue: FocusCatalogueEntry.nullable(),
    /** F13. A coach instruction we cannot measure, kept in their own words. */
    coachInstruction: z.string().nullable(),
    /** F13. True whenever `catalogue` is null. The page says so plainly. */
    unverified: z.boolean(),
    /** F13. The measurable focus paired with an unmeasurable instruction. */
    pairedFocusId: Uuid.nullable(),
    startedAt: z.iso.datetime(),
    /** F12. One entry per stream the focus can be measured in. */
    measurements: z.array(FocusMeasurement),
  })
  .openapi('ActiveFocus');

/**
 * F10, F13. Either a catalogue focus or a coach instruction we cannot measure.
 * The second case still has to name a measurable focus to pair with, because a
 * loop that cannot close is not a loop.
 */
export const SetFocus = z
  .discriminatedUnion('source', [
    z.object({
      source: z.enum(['recommended', 'self']),
      catalogueKey: z.string(),
    }),
    z.object({
      source: z.literal('coach'),
      catalogueKey: z.string().optional(),
      coachInstruction: z.string().min(1).max(500),
      pairedCatalogueKey: z.string(),
    }),
  ])
  .openapi('SetFocus');

// ─── Proof sheet ─────────────────────────────────────────────────────────────

export const ProofSheet = z
  .object({
    id: Uuid,
    token: z.string(),
    url: z.url(),
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .openapi('ProofSheet');

/**
 * F14. What a parent sees. The numbers are frozen at creation, so this shape is
 * a snapshot rather than a live query, and it deliberately carries no game list
 * and no account details.
 */
export const SharedProofSheet = z
  .object({
    playerDisplayName: z.string(),
    focusTitle: z.string(),
    coachInstruction: z.string().nullable(),
    stream: Stream,
    unit: z.string(),
    beforeValue: z.number().nullable(),
    afterValue: z.number().nullable(),
    trend: FocusTrend,
    gamesBefore: z.number().int(),
    gamesAfter: z.number().int(),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
  })
  .openapi('SharedProofSheet');

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * ADR-0018. The model turns facts we computed into prose. There is no endpoint
 * that hands it a position, because there is no prompt that receives one.
 */
export const Explanation = z
  .object({
    mistakeId: Uuid,
    text: z.string(),
    generatedAt: z.iso.datetime(),
  })
  .openapi('Explanation');

export const SocraticQuestion = z
  .object({
    mistakeId: Uuid,
    question: z.string(),
    generatedAt: z.iso.datetime(),
  })
  .openapi('SocraticQuestion');

// ─── Ops ─────────────────────────────────────────────────────────────────────

/**
 * E3. What a load balancer, and a person, get to ask every thirty seconds.
 * `database` is the part worth having: a process that is up with a database it
 * cannot reach answers every other route with a 500, and a health check that
 * did not look would keep it in service.
 */
export const Health = z
  .object({
    status: z.literal('ok'),
    database: z.literal('ok'),
  })
  .openapi('Health');
