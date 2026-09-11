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

export const GameSource = z
  .enum(['chesscom', 'lichess', 'pgn_upload', 'uscf'])
  .openapi('GameSource');
export const Color = z.enum(['white', 'black']).openapi('Color');
export const GameResult = z.enum(['1-0', '0-1', '1/2-1/2', '*']).openapi('GameResult');
export const Phase = z.enum(['opening', 'middlegame', 'endgame']).openapi('Phase');
export const Judgement = z.enum(['inaccuracy', 'mistake', 'blunder']).openapi('Judgement');
export const AnalysisStatus = z
  .enum(['pending', 'queued', 'analyzing', 'complete', 'failed'])
  .openapi('AnalysisStatus');
export const JobStatus = z.enum(['queued', 'running', 'complete', 'failed']).openapi('JobStatus');
export const Tier = z.enum(['beginner', 'intermediate', 'pro']).openapi('Tier');
/** ST-074. Beginner needs no checkout, so a purchase names one of the other two. */
export const PayableTier = z.enum(['intermediate', 'pro']).openapi('PayableTier');
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
    /** ST-080, R8. Consecutive calendar days with at least one reviewed game. */
    currentStreak: z.number().int(),
    xp: z.number().int(),
    /** Derived from `xp` (one level per 100), not stored. */
    level: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .openapi('Player');

/**
 * ST-072. The fields of the account's own player a person can edit. The player
 * is born at sign-up, so there is no create body; this is the update body only.
 */
export const UpdatePlayer = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
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
  .openapi('UpdatePlayer');

/**
 * The body of the account-deletion request. The password is the proof the
 * person holding the session is the account's owner and not a borrowed tab.
 */
export const DeleteAccount = z
  .object({
    password: z.string().min(1).max(128),
  })
  .openapi('DeleteAccount');

export const Me = z
  .object({
    userId: z.string(),
    email: z.email(),
    name: z.string(),
    tier: Tier,
    /** The single chess identity this login owns. */
    player: Player,
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

/**
 * ST-120. One point on the gap series: one imported tournament. `rating` is
 * the over-the-board rating the event's own games carry; `gap` measures it
 * against the latest online rating and is null before the first fetch stores
 * one. Nothing here is recomputed at render time.
 */
export const GapSeriesPoint = z
  .object({
    tournamentId: Uuid,
    /** The event as the player's file wrote it. */
    name: z.string(),
    /** The tournament's own date range start; the earliest dated game backs it. */
    date: z.iso.datetime(),
    rating: z.number().int(),
    gap: z.number().int().nullable(),
  })
  .openapi('GapSeriesPoint');

/**
 * ST-120. The gap across the season. `platform` names which online rating the
 * gaps measure against - Chess.com when present, else Lichess, mirroring the
 * FIDE-else-USCF preference ST-018 set on the over-the-board side - and is
 * null before the first fetch stores a rating. `skippedTournaments` counts
 * events with no plotted point: the games carry no player-side Elo header, or
 * no date to plot against.
 */
export const TransferGapSeries = z
  .object({
    playerId: Uuid,
    platform: z.enum(['chesscom', 'lichess']).nullable(),
    /** The latest online rating, the reference every point reads against. */
    onlineRating: z.number().int().nullable(),
    points: z.array(GapSeriesPoint),
    skippedTournaments: z.number().int(),
  })
  .openapi('TransferGapSeries');

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
    /** The games this import created; the analysing screen counts only these (ST-093). */
    gameIds: z.array(Uuid),
    /**
     * ST-096. The tournament the batch mostly attached to and its total game
     * count after the upload, so the web can route by tournament size. Null
     * when nothing attached, which every online import is.
     */
    tournament: z.object({ id: Uuid, gameCount: z.number().int() }).nullable(),
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

/**
 * ST-106. One pool puzzle as the drill client plays it: the position before
 * the opponent's setup move and the full UCI line, whose first move is the
 * setup and whose remainder is the solution. The client applies the setup
 * move itself, so the board orientation follows the side to move.
 */
export const PracticePuzzle = z
  .object({
    /** The Lichess puzzle id. */
    id: z.string(),
    fen: z.string(),
    moves: z.string(),
    rating: z.number().int(),
  })
  .openapi('PracticePuzzle');

/**
 * ST-150. The five answers a group can give. Four are stored on
 * `pattern_state`; `not_yet_verifiable` is derived at read time for a
 * `candidate` whose stream window is thinner than the floor, so it can never
 * go stale.
 */
export const RetirementState = z
  .enum(['active', 'candidate', 'retired', 'came_back', 'not_yet_verifiable'])
  .openapi('RetirementState');

/**
 * The same five states where the field may be absent: a weakness or a drill
 * whose group never became a candidate. Built from the same options rather
 * than `.nullable()` on the named schema, whose registration the derived
 * schema would inherit and overwrite with a nullable shape (ST-152).
 */
const RetirementStateOrNull = z.enum(RetirementState.options).nullable().openapi({
  description:
    "ST-150. The group's retirement state in the dealt stream; null when the group never became a candidate.",
});

/**
 * ST-106. One weakness group's drill: at least 20 pool puzzles matched to the
 * group's theme and the player's rating by the prototype's fallback ladder.
 * ST-122: an opening group's drill prefers its mapped ECO family first, and
 * `opening` names that family for the card when the opening rungs dealt.
 */
export const PracticeSet = z
  .object({
    kind: WeaknessKind,
    group: z.string(),
    theme: z.string().openapi({ example: 'hangingPiece' }),
    rating: z.number().int().openapi({ example: 1500 }),
    puzzles: z.array(PracticePuzzle).min(20),
    opening: z.string().nullable().openapi({
      description:
        'The ECO family the opening rungs preferred, humanized; null when the deal fell through to the theme rungs.',
    }),
    retirementState: RetirementStateOrNull,
  })
  .openapi('PracticeSet');

/**
 * ST-106. One completed drill on a pool puzzle: the client records the
 * outcome once per drill, whether the player solved it or the solution was
 * revealed. A solved drill records the day's activity (ST-103); a reveal
 * never does.
 */
export const RecordPracticePuzzle = z
  .object({
    puzzleId: z.string().min(1).max(16),
    kind: WeaknessKind,
    group: z.string().min(1).max(64),
    solved: z.boolean(),
  })
  .openapi('RecordPracticePuzzle');

/** ST-106, ST-107. The running tally for one drilled puzzle, with its new review rung. */
export const PracticePuzzleTally = z
  .object({
    attempts: z.number().int(),
    solved: z.boolean(),
    /** The review rung after this attempt: 0 failed or fresh, 3 the thirty-day top. */
    reviewLevel: z.number().int().min(0).max(3),
    /** When the puzzle returns for review; level 3 sits 30 days out. */
    nextReviewAt: z.iso.datetime(),
  })
  .openapi('PracticePuzzleTally');

/** ST-107. One puzzle in the player's review queue, with its schedule. */
export const PracticeQueueItem = z
  .object({
    puzzleId: z.string(),
    fen: z.string(),
    moves: z.string(),
    rating: z.number().int(),
    kind: WeaknessKind,
    group: z.string(),
    reviewLevel: z.number().int().min(0).max(3),
    nextReviewAt: z.iso.datetime(),
    solved: z.boolean(),
    /** How many drills this puzzle has recorded; 0 means dealt but unstarted. */
    attempts: z.number().int().min(0),
  })
  .openapi('PracticeQueueItem');

/**
 * ST-107. The three buckets the puzzles page shows: what is pending now
 * (due reviews plus the deal that has not been started), what is coming up
 * for review, and what has been mastered.
 */
export const PracticeQueue = z
  .object({
    due: z.array(PracticeQueueItem),
    upcoming: z.array(PracticeQueueItem),
    mastered: z.array(PracticeQueueItem),
  })
  .openapi('PracticeQueue');

/** ST-124. One due review the practice surface's section offers, with its group. */
export const PracticeReviewItem = z
  .object({
    puzzleId: z.string(),
    kind: WeaknessKind,
    group: z.string(),
    reviewLevel: z.number().int().min(1).max(3),
  })
  .openapi('PracticeReviewItem');

/**
 * ST-124. The practice surface's due-for-review section: the player's due
 * ladder puzzles, soonest first, capped at ten review solves per calendar
 * day. `remaining` is what is left of the cap after today's review solves,
 * so a spent day reads as empty with the reason attached.
 */
export const PracticeReviews = z
  .object({
    reviews: z.array(PracticeReviewItem),
    remaining: z.number().int().min(0).max(10),
  })
  .openapi('PracticeReviews');

export const MovePly = z
  .object({
    ply: z.number().int(),
    san: z.string(),
    uci: z.string(),
    fenBefore: z.string(),
    phase: Phase.nullable(),
    evaluation: Evaluation.nullable(),
    bestMoveSan: z.string().nullable(),
    /** The engine's recommended move as from/to UCI, e.g. "g8f6"; null in a finished position. */
    bestMoveUci: z.string().nullable(),
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
    /** ST-149. The opponent's Elo this mistake was weighted against; null when unknown. */
    opponentElo: z.number().int().nullable(),
    /** ST-149. `cpLoss` weighted by opponent strength; equals `cpLoss` when `opponentElo` is null. */
    severity: z.number(),
  })
  .openapi('Mistake');

export const GameDetail = GameSummary.extend({
  pgn: z.string(),
  plies: z.array(MovePly),
  mistakes: z.array(Mistake),
  /**
   * ST-121. The time-trouble onset the stored report for this game's stream
   * computed (ST-042); null when no report row exists or it has no onset.
   * Read, never regenerated, on the game read.
   */
  timeTroubleFromMove: z.number().int().nullable(),
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
      reason: z.enum(['no_clock_data', 'not_enough_evidence']),
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

// ─── Patterns (ST-150) ───────────────────────────────────────────────────────

/** ST-150. The game whose analysis triggered a relapse, named for the alert copy. */
export const PatternAlertGame = z
  .object({
    gameId: Uuid,
    playedAt: z.iso.datetime().nullable(),
    whiteName: z.string().nullable(),
    blackName: z.string().nullable(),
  })
  .openapi('PatternAlertGame');

/** ST-150. One weakness group's verified-retirement state, for one stream. */
export const PatternState = z
  .object({
    kind: WeaknessKind,
    groupKey: z.string(),
    label: z.string(),
    stream: Stream,
    state: RetirementState,
    masteredAt: z.iso.datetime(),
    retiredAt: z.iso.datetime().nullable(),
    cameBackAt: z.iso.datetime().nullable(),
    lastAlertGame: PatternAlertGame.nullable(),
    /** ST-152. Analysed window games since `masteredAt`: how wide the verification window is. */
    windowGames: z.number().int(),
    /** ST-152. The group's instances inside those window games, defined exactly as the leak's. */
    windowInstances: z.number().int(),
    /** ST-152. What those instances cost in half-points. */
    windowCost: z.number(),
    /** ST-152. How many times this group has come back; the history a re-mastery preserves. */
    relapses: z.number().int(),
  })
  .openapi('PatternState', {
    example: {
      kind: 'motif',
      groupKey: 'hanging_piece',
      label: 'Hanging piece',
      stream: 'tournament',
      state: 'retired',
      masteredAt: '2026-08-01T10:00:00.000Z',
      retiredAt: '2026-08-20T10:00:00.000Z',
      cameBackAt: null,
      lastAlertGame: null,
      windowGames: 10,
      windowInstances: 0,
      windowCost: 0,
      relapses: 0,
    },
  });

/** ST-150. The player's weakness groups and where each stands. */
export const PatternReport = z
  .object({
    playerId: Uuid,
    stream: Stream,
    /** ST-152. The verification window's size, so the board can name the window that retired a debt. */
    verificationFloor: z.number().int(),
    patterns: z.array(PatternState),
  })
  .openapi('PatternReport');

// ─── Report ──────────────────────────────────────────────────────────────────

/**
 * F9. The rating leak is the only number in this document that a coach will
 * argue with, so the report carries the evidence beside it rather than the
 * figure alone.
 */
/** ST-098. One place a weakness was found: the mistake row and its game. */
export const WeaknessEvidence = z
  .object({
    gameId: Uuid,
    whiteName: z.string().nullable(),
    blackName: z.string().nullable(),
    playedAt: z.iso.datetime().nullable(),
    moveNumber: z.number().int(),
    /** ST-100. The ply of the played move, so a deep link lands on the position. */
    ply: z.number().int(),
    moveSan: z.string().openapi({ example: 'Nf6' }),
    bestMoveSan: z.string().openapi({ example: 'e5' }),
    phase: Phase.nullable(),
    judgement: Judgement,
    cpLoss: z.number().int(),
  })
  .openapi('WeaknessEvidence');

export const ActionItem = z
  .object({
    id: Uuid,
    /** Position in the progressive set: 0 Beginner, 1 Intermediate, 2 Advanced. */
    resourceIndex: z.number().int().min(0).max(2),
    tier: z.enum(['beginner', 'intermediate', 'advanced']),
    /** The assigned resource, verbatim, tier tag included. */
    resource: z.string(),
    status: z.enum(['pending', 'completed']),
    /** The prototype's deadline: a week to work through the resource. */
    dueAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .openapi('ActionItem');
/**
 * ST-123. How consistently the player follows their own opening lines in one
 * ECO group: the share of the group's tournament games whose first ten plies
 * match the player's modal line. Computed on the tournament stream only, per
 * F12's partition; null on an online report, where the figure does not
 * apply.
 */
export const LineConsistency = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('ok'),
      /** Games in the group whose first ten plies are the modal line. */
      matched: z.number().int(),
      /** Every game in the group, whatever its length. */
      games: z.number().int(),
    }),
    z.object({
      status: z.literal('below_floor'),
      games: z.number().int(),
    }),
    z.object({
      status: z.literal('no_full_line'),
      games: z.number().int(),
    }),
  ])
  .openapi('LineConsistency');

export const Weakness = z
  .object({
    id: Uuid,
    kind: WeaknessKind,
    label: z.string().openapi({ example: 'Sicilian, Alapin' }),
    eco: z.string().nullable().openapi({ example: 'B22' }),
    ratingLeak: z.number().int().openapi({
      example: 85,
      description: 'Estimated rating points this weakness costs per season.',
    }),
    saturated: z.boolean(),
    halfPointsLost: z.number(),
    gamesAffected: z.number().int(),
    occurrences: z.number().int(),
    rank: z.number().int().min(1),
    /** ST-098. What to do about the weakness; null when no honest line exists. */
    advice: z.string().nullable(),
    /** ST-107. The weakness's curriculum: three resources, each done on its own. */
    actionItems: z.array(ActionItem),
    /**
     * ST-106. The stable group identity `groupKeyOf` recovered from the
     * label, or null when the label predates the map. The practice link
     * carries it to the drill route; the client never derives it itself.
     */
    groupKey: z.string().nullable(),
    /**
     * ST-106. The solved drills the player has recorded against this
     * weakness group's puzzle pool, from one grouped read. The Practiced
     * badge and the practice-more CTA key on it.
     */
    drilled: z.number().int().min(0),
    /** ST-098. The worst instances behind the aggregate, newest first. */
    evidence: z.array(WeaknessEvidence),
    /** ST-123. The line-following share for opening groups; null elsewhere. */
    lineConsistency: LineConsistency.nullable(),
    /**
     * ST-150. The weakness group's verified-retirement state, or null when the
     * group has no `pattern_state` row (it never became a retirement
     * candidate). `not_yet_verifiable` is derived at read time from the
     * candidate's window, so it can never go stale.
     */
    retirementState: RetirementStateOrNull,
  })
  .openapi('Weakness');

/**
 * ST-154. The times the opponent blundered and the player did not convert.
 * Counts are per report scope; the instances are the most recent misses, each
 * pointing at the blunder ply for the deep link and carrying the slip's phase
 * for the drill route.
 */
export const MissedPunishmentInstance = z
  .object({
    gameId: Uuid,
    whiteName: z.string().nullable(),
    blackName: z.string().nullable(),
    playedAt: z.iso.datetime().nullable(),
    /** The opponent's blundering ply, where the deep link lands. */
    ply: z.number().int(),
    /** The ply played from the position where the advantage fell below the hold floor. */
    slipPly: z.number().int(),
    /** The phase of the slip position, the group the drill routes into. */
    slipPhase: Phase.nullable(),
  })
  .openapi('MissedPunishmentInstance');

export const MissedPunishment = z
  .object({
    /** Misses across the report's season window. */
    seasonCount: z.number().int().min(0),
    /** Misses in the rolling thirty days ending at the window's end. */
    thirtyDayCount: z.number().int().min(0),
    /** The most recent misses, newest first, at most three. */
    instances: z.array(MissedPunishmentInstance).max(3),
  })
  .openapi('MissedPunishment');

export const Report = z
  .object({
    id: Uuid,
    playerId: Uuid,
    stream: Stream,
    /**
     * ST-098. Set when this report is scoped to one tournament's games; null
     * for the stream-wide report.
     */
    tournamentId: Uuid.nullable(),
    generatedAt: z.iso.datetime(),
    gamesCovered: z.number().int(),
    windowStart: z.iso.datetime().nullable(),
    windowEnd: z.iso.datetime().nullable(),
    /** F6. Present when the stream has enough clocked games; null otherwise. */
    timeTroubleFromMove: z.number().int().nullable(),
    /** DEBT-016. Why `timeTroubleFromMove` is null; null when the onset move is set. */
    timeTroubleReason: z.enum(['no_clock_data', 'not_enough_evidence']).nullable(),
    /** S2. Ranked by cost to the player, not by recency. */
    weaknesses: z.array(Weakness),
    /**
     * ST-154. The missed-punishment line: how often the opponent's blunders
     * went unpunished in this scope. Present whenever the report has a
     * window; the counts are zero when there was nothing to find.
     */
    missedPunishment: MissedPunishment.nullable(),
    /** ADR-0018. Prose over the numbers above, cached against this aggregation. */
    narrative: z.string().nullable(),
  })
  .openapi('Report');

/**
 * ST-107. The body of submitting one action item's assessment: which item and
 * the summary the model will judge. The server resolves the item against the
 * session's player, so only an assigned item can be assessed.
 */
export const MarkActionItemDone = z
  .object({
    actionItemId: Uuid,
    summary: z.string().min(1).max(2000).openapi({
      description: 'The player\u2019s own summary of what they took from the resource.',
    }),
  })
  .openapi('MarkActionItemDone');

/** ST-107. The verdict on one assessment, plus the item's resulting state. */
export const ActionItemDone = z
  .object({
    pass: z.boolean(),
    feedback: z.string(),
    /** Set when the item is now done: on this pass, or on an earlier one. */
    completedAt: z.iso.datetime().nullable(),
  })
  .openapi('ActionItemDone');

/** ST-107. The curriculum page's list: every assigned item, newest first. */
export const ActionItemList = z
  .object({
    items: z.array(
      ActionItem.extend({
        kind: WeaknessKind,
        label: z.string(),
        /** The assessment text the model accepted; null while pending. */
        summary: z.string().nullable(),
      }),
    ),
  })
  .openapi('ActionItemList');

/**
 * The body of asking for one weakness's coaching: which weakness row, by id.
 * The server resolves the row against the session's player, so only a
 * weakness on the player's own reports can be coached.
 */
export const GenerateWeakness = z.object({ weaknessId: Uuid }).openapi('GenerateWeakness');

/**
 * The response of the on-demand coaching: the model-written advice line for
 * the weakness (null keeps the template copy the report already carries) and
 * the group's three assigned resources, assigned on this call if absent.
 */
export const WeaknessCoaching = z
  .object({
    advice: z.string().nullable(),
    actionItems: z.array(ActionItem),
  })
  .openapi('WeaknessCoaching');

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
    /**
     * ST-116. The games-to-verdict distance: 0 exactly when `trend` is a
     * verdict, the current half's deficit when the window floor is the
     * refusing cause, and null when importing alone cannot close the gap.
     * Never a promise the verifier would refuse.
     */
    gamesToGo: z.number().int().nullable(),
  })
  .openapi('FocusMeasurement');

/**
 * ST-129. Drill effort inside a focus's family, from `puzzle_attempt` rows.
 * A row exists the moment a deal assigns a puzzle, so `total` counts rows
 * with a completed drill (`attempts > 0`); `solved` is the sticky flag;
 * `groups` is the distinct weakness groups worked.
 */
export const FocusPractice = z
  .object({
    total: z.number().int(),
    solved: z.number().int(),
    groups: z.number().int(),
  })
  .openapi('FocusPractice');

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
    /**
     * ST-129. The player's worked drills inside this focus's family, null
     * when there is no measurable focus. It never enters verdict
     * arithmetic: practice measures effort, the two speeds measure play.
     */
    practice: FocusPractice.nullable(),
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

/** ST-117. A live assignment link, the share shape the proof sheet returns. */
export const AssignmentLink = z
  .object({
    id: Uuid,
    token: z.string(),
    url: z.url(),
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .openapi('AssignmentLink');

/**
 * ST-117. What an opened assignment link serves: the catalogue focus it names
 * and the coach's instruction verbatim. Deliberately nothing else - no games,
 * no report, no account data ride the token.
 */
export const SharedAssignment = z
  .object({
    focusTitle: z.string(),
    focusDescription: z.string(),
    instruction: z.string(),
  })
  .openapi('SharedAssignment');

/** ST-118. A live game share link, the share shape the proof sheet returns. */
export const GameShareLink = z
  .object({
    id: Uuid,
    token: z.string(),
    url: z.string(),
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .openapi('GameShareLink');

/** ST-127. A live report share card, the share shape the game share returns, plus its frozen payload. */
export const ReportCardLink = z
  .object({
    id: Uuid,
    token: z.string(),
    url: z.string(),
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    ratingLeak: z.number().int(),
    label: z.string(),
  })
  .openapi('ReportCardLink');

/**
 * ST-127. What an opened share card serves: the headline leak number and its
 * weakness label. Two fields, and the payload-scoping test pins the key set,
 * so the card cannot quietly grow into a profile - no games, no opponents, no
 * account identity, no second weakness.
 */
export const SharedReportCard = z
  .object({
    ratingLeak: z.number().int(),
    label: z.string(),
  })
  .openapi('SharedReportCard');

/**
 * ST-118. What an opened game share link serves: exactly one reviewed game,
 * read-only. The PGN names travel with the game; nothing account-owned does -
 * no player or game id, no stream, no report. The mistakes carry no coach
 * explanation: that is generated prose on the account's budget, and sharing
 * never spends a unit.
 */
export const SharedGame = z
  .object({
    whiteName: z.string().nullable(),
    blackName: z.string().nullable(),
    result: GameResult,
    playerColor: z.enum(['white', 'black']).nullable(),
    plies: z.array(MovePly),
    mistakes: z.array(Mistake.omit({ explanation: true })),
  })
  .openapi('SharedGame');

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * ADR-0018. The model turns facts we computed into prose. There is no endpoint
 * that hands it a position, because there is no prompt that receives one.
 *
 * ST-128. `remaining` and `monthlyCap` carry the account's coach budget for
 * the card's counter, straight from `EXPLANATION_MONTHLY_CAP`; both null on
 * an unlimited plan, so a counter never renders for pro.
 */
export const Explanation = z
  .object({
    mistakeId: Uuid,
    text: z.string(),
    generatedAt: z.iso.datetime(),
    remaining: z.number().int().nullable(),
    monthlyCap: z.number().int().nullable(),
  })
  .openapi('Explanation');

export const SocraticQuestion = z
  .object({
    mistakeId: Uuid,
    question: z.string(),
    generatedAt: z.iso.datetime(),
  })
  .openapi('SocraticQuestion');

/**
 * ST-080, ADR-0029. One candidate move from the CCT scan: a check, a
 * capture, or a threat available at the mistake position. Enumerated by
 * ChessOps attack geometry, not a model, so there is nothing to cache.
 */
export const CctMove = z
  .object({
    san: z.string(),
    uci: z.string(),
    type: z.enum(['Check', 'Capture', 'Threat']),
    threatCategory: z.enum(['Checkmate', 'Material']).optional(),
    /** True when this move is the engine's best move at the position. */
    isGoodOption: z.boolean(),
    /** True unless a one-ply lookahead shows the move is an outright blunder. */
    isUseful: z.boolean(),
  })
  .openapi('CctMove');

export const CctScan = z
  .object({
    mistakeId: Uuid,
    checks: z.array(CctMove),
    captures: z.array(CctMove),
    threats: z.array(CctMove),
  })
  .openapi('CctScan');

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

// ─── Billing ────────────────────────────────────────────────────────────────

/** ST-044, ST-074. The body that starts a checkout for intermediate or pro. */
export const CheckoutRequest = z.object({ tier: PayableTier }).openapi('CheckoutRequest');

/** ST-044. What the client needs to open Razorpay Checkout for the order. */
export const CheckoutResponse = z
  .object({
    orderId: z.string(),
    /** Minor units: cents. */
    amount: z.number().int(),
    currency: z.string(),
    keyId: z.string(),
  })
  .openapi('CheckoutResponse');

// ─── Priming ────────────────────────────────────────────────────────────────

/**
 * ST-153. A live priming token, as settings sees it. The raw secret appears
 * only in the create response, exactly once; every later read names a prefix,
 * the way a key list names its last four characters, so the credential never
 * sits in a settings response twice.
 */
export const PrimingToken = z
  .object({
    id: Uuid,
    tokenPrefix: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi('PrimingToken');

/**
 * ST-153. The create response: the one place the raw secret is ever served.
 * Every other surface names the prefix; the extension pastes this secret into
 * its options page once.
 */
export const PrimingTokenWithSecret = PrimingToken.extend({
  token: z.string(),
}).openapi('PrimingTokenWithSecret');

/**
 * ST-153. One weakness group on the pre-game brief. The payload is the whole
 * point of the story's scope record: labels and counts, and nothing else - no
 * account identity, no opponent names, no move-level data, no eval swings.
 * The payload-scoping test pins this key set so the brief cannot quietly grow
 * into a profile.
 */
export const PrimingBriefGroup = z
  .object({
    label: z.string(),
    stream: Stream,
    /** Mistake instances in this group over the trailing seven days. */
    weekCount: z.number().int(),
  })
  .openapi('PrimingBriefGroup');

/**
 * ST-153. What the extension renders for fifteen seconds before a game. The
 * top two or three currently active weakness groups plus the active focus
 * line when one exists, and nothing else on the account.
 */
export const PrimingBrief = z
  .object({
    groups: z.array(PrimingBriefGroup).max(3),
    focusLabel: z.string().nullable(),
  })
  .openapi('PrimingBrief');
