/**
 * The version one database schema.
 *
 * Every table here traces to a requirement in the project repository's
 * business analysis, and the requirement id is named above the table. If a
 * column cannot say which requirement it serves, it does not belong yet.
 *
 * Two rules the prototype taught us the hard way, recorded in the carry-over
 * notes, apply to this file. Every table is created by a checked-in migration,
 * starting with the first one, and no function body is ever edited anywhere
 * except in a migration file.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema.ts';

// ─── Enumerations ────────────────────────────────────────────────────────────

/**
 * F1. Tournament and online games describe different players, so the stream a
 * game belongs to partitions every aggregate downstream. This is the single
 * most load-bearing enum in the schema.
 */
export const streamEnum = pgEnum('stream', ['tournament', 'online']);

export const gameSourceEnum = pgEnum('game_source', ['chesscom', 'lichess', 'pgn_upload']);

export const colorEnum = pgEnum('color', ['white', 'black']);

export const gameResultEnum = pgEnum('game_result', ['1-0', '0-1', '1/2-1/2', '*']);

export const phaseEnum = pgEnum('game_phase', ['opening', 'middlegame', 'endgame']);

/**
 * The resumable status field carried over from the prototype. Analysis is
 * chunked and a crash resumes from the last finished chunk (N1), so a game
 * sits in `analyzing` for minutes at a time and that has to be visible.
 */
export const analysisStatusEnum = pgEnum('analysis_status', [
  'pending',
  'queued',
  'analyzing',
  'complete',
  'failed',
]);

export const judgementEnum = pgEnum('judgement', ['inaccuracy', 'mistake', 'blunder']);

/** F4, F5, F6. The four things a weakness can be about. */
export const weaknessKindEnum = pgEnum('weakness_kind', [
  'opening',
  'motif',
  'phase',
  'time_trouble',
]);

/** F10, F13. Where the active focus came from. */
export const focusSourceEnum = pgEnum('focus_source', ['recommended', 'coach', 'self']);

/** F12. A verdict of `insufficient_evidence` is a first-class answer, not a null. */
export const focusTrendEnum = pgEnum('focus_trend', [
  'improving',
  'flat',
  'declining',
  'insufficient_evidence',
]);

/** T1. A backfill and an incremental import have different cost and timeout profiles. */
export const importKindEnum = pgEnum('import_kind', ['backfill', 'incremental']);

export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'complete', 'failed']);

export const tierEnum = pgEnum('tier', ['free', 'paid']);

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * B4. The person paying and the person playing are different people, and the
 * account model has to support that from the first version because retrofitting
 * it means migrating every account we have.
 *
 * A `user` is a login (better-auth, ADR-0011). A `player` is a chess identity.
 * A self-managing adult owns their own player. A minor signs up themselves and
 * is gated until their guardian confirms consent by email (ST-034, ADR-0035);
 * the guardian is a bare email, not a second account with its own players.
 */
export const player = pgTable(
  'player',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),

    /**
     * N7. Birth year rather than a full date of birth: it is the least we can
     * hold and still know whether COPPA applies. The compliance mechanism
     * itself is an open question and blocks launch, so nothing here assumes
     * which way it lands.
     */
    birthYear: smallint('birth_year'),

    /**
     * The distinction the whole product rests on. Over-the-board ratings are
     * first-class and separate from anything an online site reports.
     */
    fideId: text('fide_id'),
    fideRating: smallint('fide_rating'),
    uscfId: text('uscf_id'),
    uscfRating: smallint('uscf_rating'),

    /** S1. One username is the whole of onboarding. */
    chesscomUsername: text('chesscom_username'),
    lichessUsername: text('lichess_username'),

    /**
     * ST-018. Fetched from the platform's public API; null until fetched, and
     * null when the platform reports nothing. Never zero for a failed fetch.
     */
    chesscomRating: smallint('chesscom_rating'),
    lichessRating: smallint('lichess_rating'),
    ratingFetchedAt: timestamp('rating_fetched_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('player_owner_idx').on(t.ownerUserId)],
);

/**
 * ST-034, N7. The consent a guardian gives for a minor's own account. One row
 * per minor: the guardian email lives on `user`, and this row records whether
 * the emailed link has been confirmed. `consentGrantedAt` and `consentMethod`
 * stay null until the confirm route writes them, so consent can only ever be
 * recorded by the route that owns the token.
 */
export const guardianConsent = pgTable(
  'guardian_consent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    consentGrantedAt: timestamp('consent_granted_at', { withTimezone: true }),
    consentMethod: text('consent_method'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('guardian_consent_user_unique').on(t.userId)],
);

/** B2, O3. The free tier gives one real diagnosis; the paid tier gives the loop. */
export const subscription = pgTable('subscription', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  tier: tierEnum('tier').notNull().default('free'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  /** Payment provider is undecided and out of scope until there is something to sell. */
  provider: text('provider'),
  providerRef: text('provider_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Import and games ────────────────────────────────────────────────────────

/**
 * T1. First import backfills a season in one operation. The incremental import
 * that follows is a different job with a different timeout profile, which is
 * why `kind` is stored rather than inferred.
 */
export const importJob = pgTable(
  'import_job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    source: gameSourceEnum('source').notNull(),
    kind: importKindEnum('kind').notNull(),
    /** Null for a PGN upload, which carries no account name. */
    username: text('username'),
    /** F1. Every game is tagged at import, and an upload has to say which stream it is. */
    stream: streamEnum('stream').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    gamesFound: integer('games_found').notNull().default(0),
    gamesImported: integer('games_imported').notNull().default(0),
    /** F2. Malformed PGN is rejected at the boundary and the count is reported back. */
    gamesRejected: integer('games_rejected').notNull().default(0),
    /**
     * F1. Games stored with no side decided, because the player's name matched
     * both tags or neither. A record of what this import found rather than a
     * live count: resolving a game later does not rewrite the job's history.
     */
    gamesUndetermined: integer('games_undetermined').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('import_job_player_idx').on(t.playerId, t.createdAt)],
);

/**
 * F1, S5. One row per tournament a player has games in, reconstructed from the
 * games we already hold rather than collected from the player.
 *
 * A tournament belongs to one player. Two players at the same event have two
 * rows, and that is correct rather than duplication: the row carries that
 * player's games, and merging them would put one player's history inside
 * another's. The player id is therefore part of every unique index, so two
 * players' games can never resolve to one tournament even when their tags are
 * identical.
 *
 * `name` is the event as the player's file wrote it, kept for display; `key` is
 * the normalised event name the grouping matches on; `site` is the site as
 * written (the identity rule normalises it for comparison, so it is stored raw
 * like every other tag). `startedAt`/`endedAt` cover the date range of the
 * games in the row, and are what separates the same annual event in two
 * different years.
 *
 * There is deliberately no unique index on the grouping key. The identity rule
 * joins two games when their dates are within 30 days, so two tournaments can
 * legitimately share a (player, event, site) when they are a year apart, and a
 * static unique index cannot express a relative window. Uniqueness is enforced
 * by the single attach function both the importer and the backfill call, which
 * always filters on `player_id`, so two players' games can never resolve to one
 * tournament even when their tags are identical.
 */
export const tournament = pgTable(
  'tournament',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    /** Display name, the event as the player's file wrote it. */
    name: text('name').notNull(),
    /** The normalised event name the grouping matches on. */
    key: text('key').notNull(),
    site: text('site'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tournament_player_key_idx').on(t.playerId, t.key),
    index('tournament_player_idx').on(t.playerId),
  ],
);

/**
 * F1, F2. One row per game the player played, tagged with its stream at import.
 *
 * PGN is stored whole (ADR-0010) because it is the only lossless record of what
 * was played, and every parsed tag below is a denormalisation of it kept for
 * querying. The tag set is the one the prototype's `games` table proved was
 * needed for tournament play: event, site, round, and board all survive upload.
 */
export const game = pgTable(
  'game',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    importJobId: uuid('import_job_id').references(() => importJob.id, { onDelete: 'set null' }),
    /**
     * The tournament this game belongs to, set at import and by the backfill.
     * Nullable is the correct shape rather than a compromise: an online game
     * has no tournament, and a tournament-stream game with no `[Event]` tag
     * has none we can name.
     */
    tournamentId: uuid('tournament_id').references(() => tournament.id, {
      onDelete: 'set null',
    }),

    stream: streamEnum('stream').notNull(),
    source: gameSourceEnum('source').notNull(),
    /**
     * The provider's own id, used to make re-importing a season idempotent.
     * Null for PGN uploads, where `pgnHash` does the same job.
     */
    externalId: text('external_id'),
    pgnHash: text('pgn_hash').notNull(),
    pgn: text('pgn').notNull(),

    playerColor: colorEnum('player_color'),
    result: gameResultEnum('result').notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }),
    moveCount: smallint('move_count'),

    /** Seven-tag roster plus the tournament tags. */
    event: text('event'),
    site: text('site'),
    round: smallint('round'),
    board: smallint('board'),
    whiteName: text('white_name'),
    blackName: text('black_name'),
    whiteElo: smallint('white_elo'),
    blackElo: smallint('black_elo'),
    /** F4. Aggregation is by ECO code; the opening name is for display only. */
    eco: text('eco'),
    opening: text('opening'),
    timeControl: text('time_control'),

    /**
     * F6, F10. Time management is measured on online games alone, because a
     * tournament game only carries clock times if the player copied them off a
     * scoresheet. This flag is what stops us inventing the number.
     */
    hasClockData: boolean('has_clock_data').notNull().default(false),

    analysisStatus: analysisStatusEnum('analysis_status').notNull().default('pending'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    analysisError: text('analysis_error'),

    /**
     * B3, N4. Cost per analyzed game is an objective (O4) with no number behind
     * it yet, and it gates both the free-tier caps and the price. Recording it
     * per game is what turns it from an estimate into a measurement, so these
     * columns exist before the first game is analyzed rather than after.
     */
    analysisNodes: integer('analysis_nodes'),
    analysisDurationMs: integer('analysis_duration_ms'),
    analysisCostMicros: integer('analysis_cost_micros'),

    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Re-importing a season must not duplicate games. Two indexes because a
    // provider game has an id and an upload does not.
    uniqueIndex('game_external_unique')
      .on(t.playerId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex('game_pgn_unique').on(t.playerId, t.pgnHash),
    index('game_stream_idx').on(t.playerId, t.stream, t.playedAt),
    index('game_analysis_status_idx').on(t.analysisStatus),
    index('game_eco_idx').on(t.playerId, t.stream, t.eco),
  ],
);

/**
 * F3. The evaluation per move, one row per ply.
 *
 * Evaluations are stored white-absolute, as separate `cp` and `mate` columns
 * rather than a JSONB blob, because the classifier reads them on every report
 * and a JSONB column cannot be indexed or summed without unpacking. Centipawns
 * are integers: the classifier expects 320, not 3.2.
 */
export const movePly = pgTable(
  'move_ply',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    ply: smallint('ply').notNull(),
    san: text('san').notNull(),
    uci: text('uci').notNull(),
    /** ADR-0010. FEN identifies the position the move was played from. */
    fenBefore: text('fen_before').notNull(),
    phase: phaseEnum('phase'),

    evalCp: integer('eval_cp'),
    evalMate: smallint('eval_mate'),
    bestMoveSan: text('best_move_san'),
    bestMoveUci: text('best_move_uci'),

    /** F6. Online games only. Null everywhere else, and `game.hasClockData` says which. */
    clockMs: integer('clock_ms'),
    moveTimeMs: integer('move_time_ms'),
  },
  (t) => [uniqueIndex('move_ply_unique').on(t.gameId, t.ply)],
);

// ─── Diagnosis ───────────────────────────────────────────────────────────────

/**
 * F5, F9. The classified subset of plies: where the player lost something.
 *
 * The column list is deliberately close to the fact set ADR-0018 allows the
 * model to see. If a claim is not in this row or derivable from `fen` with
 * chess.js, the model may not make it.
 */
export const mistake = pgTable(
  'mistake',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    ply: smallint('ply').notNull(),
    moveNumber: smallint('move_number').notNull(),
    movingColor: colorEnum('moving_color').notNull(),
    phase: phaseEnum('phase'),

    fen: text('fen').notNull(),
    moveSan: text('move_san').notNull(),
    bestMoveSan: text('best_move_san').notNull(),

    evalBeforeCp: integer('eval_before_cp'),
    evalBeforeMate: smallint('eval_before_mate'),
    evalAfterCp: integer('eval_after_cp'),
    evalAfterMate: smallint('eval_after_mate'),

    judgement: judgementEnum('judgement').notNull(),
    cpLoss: integer('cp_loss').notNull(),
    winProbDrop: real('win_prob_drop').notNull(),

    /** F5. Set by `attributeMotif` (ST-024); null for a mistake no motif explains. */
    motif: text('motif'),

    /**
     * F9. The rating leak counts only swings that crossed a result boundary,
     * meaning a win turned into a draw or a draw into a loss. It never
     * extrapolates from positions the player went on to win anyway, so these
     * two columns are what separates a defensible number from a dismissible
     * one. A coach reads this.
     */
    crossedResultBoundary: boolean('crossed_result_boundary').notNull().default(false),
    halfPointsLost: real('half_points_lost').notNull().default(0),

    /**
     * ADR-0018. Generated on demand when a player opens the mistake, then
     * served from here forever. Most analyzed mistakes are never opened.
     */
    explanation: text('explanation'),
    explanationGeneratedAt: timestamp('explanation_generated_at', { withTimezone: true }),
    socraticQuestion: text('socratic_question'),
    socraticQuestionGeneratedAt: timestamp('socratic_question_generated_at', {
      withTimezone: true,
    }),
  },
  (t) => [
    uniqueIndex('mistake_unique').on(t.gameId, t.ply),
    index('mistake_motif_idx').on(t.motif),
    index('mistake_leak_idx').on(t.gameId, t.crossedResultBoundary),
  ],
);

/**
 * F7. The aggregation across games, kept per stream because a report blended
 * across both would describe a player who does not exist.
 *
 * This row is what ADR-0018's report prose caches against: `narrative`
 * regenerates when the aggregation it describes moves, not on every read.
 */
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    stream: streamEnum('stream').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    gamesCovered: integer('games_covered').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    /**
     * F6. The move number where time per move collapses, for online play only.
     * Null on a tournament report by design rather than by accident.
     */
    timeTroubleFromMove: smallint('time_trouble_from_move'),
    narrative: text('narrative'),
    narrativeGeneratedAt: timestamp('narrative_generated_at', { withTimezone: true }),
  },
  (t) => [index('report_player_idx').on(t.playerId, t.stream, t.generatedAt)],
);

/**
 * F7, F9. One weakness on a report, ranked by what it costs the player.
 *
 * A child table rather than a JSONB payload, because the rating leak is the
 * number the whole product is judged on and a number that matters gets a
 * column.
 */
export const weakness = pgTable(
  'weakness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => report.id, { onDelete: 'cascade' }),
    kind: weaknessKindEnum('kind').notNull(),
    /** Display label: an opening name, a motif name, a phase. */
    label: text('label').notNull(),
    /** F4. Set when `kind` is `opening`, because aggregation is by code. */
    eco: text('eco'),
    /** F9. Rating points per season. The only currency the player cares about. */
    ratingLeak: integer('rating_leak').notNull(),
    /** ST-036. True when the leak is the whole season's deficit, a floor. */
    saturated: boolean('saturated').notNull().default(false),
    halfPointsLost: real('half_points_lost').notNull(),
    gamesAffected: integer('games_affected').notNull(),
    occurrences: integer('occurrences').notNull(),
    /** S2. A ranked diagnosis, not a list of games to read through. */
    rank: smallint('rank').notNull(),
  },
  (t) => [uniqueIndex('weakness_rank_unique').on(t.reportId, t.rank)],
);

// ─── Prescription ────────────────────────────────────────────────────────────

/**
 * F10, F13. The catalogue of focuses the system can measure.
 *
 * Reference data, but a table rather than a constant, because F13 is the
 * mechanism by which it grows: coach instructions we cannot measure accumulate
 * until enough of them say the same thing and we build the proxy. A constant
 * would make that a deploy instead of a decision.
 */
export const focusCatalogue = pgTable('focus_catalogue', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  /** The number behind the focus, in words, for the page that explains it. */
  measureDescription: text('measure_description').notNull(),
  /**
   * F10, F12. Time management is online only. A focus measurable in one stream
   * reports a trend for that stream alone rather than a thin number for both.
   */
  measurableStreams: streamEnum('measurable_streams').array().notNull(),
  version: smallint('version').notNull().default(1),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
});

/**
 * F10, F11, F13. One active focus at a time, per player.
 *
 * `catalogueId` null with `coachInstruction` set is the F13 case: a coach said
 * something we cannot measure, we record it in their words, show it as active,
 * mark it unverified, and pair it with a measurable focus so the loop still
 * closes.
 */
export const playerFocus = pgTable(
  'player_focus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    catalogueId: uuid('catalogue_id').references(() => focusCatalogue.id),
    /** F13. The coach's own words, kept verbatim. */
    coachInstruction: text('coach_instruction'),
    source: focusSourceEnum('source').notNull(),
    /** F11. Set when this focus narrowed out of a broader one as evidence accumulated. */
    narrowedFromId: uuid('narrowed_from_id'),
    /** F13. The measurable focus paired with an unmeasurable instruction. */
    pairedFocusId: uuid('paired_focus_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    // One active focus at a time is a database constraint, not a convention.
    uniqueIndex('player_focus_one_active')
      .on(t.playerId)
      .where(sql`${t.endedAt} is null`),
    index('player_focus_player_idx').on(t.playerId, t.startedAt),
  ],
);

/**
 * F12. Verification over a rolling window, kept per stream.
 *
 * `windowGames` is not bookkeeping. S4 and F14 both need the product to say how
 * much evidence sits behind a verdict, so that a single five-game tournament
 * never settles anything on its own.
 */
export const focusMeasurement = pgTable(
  'focus_measurement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerFocusId: uuid('player_focus_id')
      .notNull()
      .references(() => playerFocus.id, { onDelete: 'cascade' }),
    stream: streamEnum('stream').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
    windowGames: smallint('window_games').notNull(),
    baselineValue: real('baseline_value'),
    currentValue: real('current_value'),
    /** What the two values are in: a percentage, a move number, an evaluation. */
    unit: text('unit').notNull(),
    trend: focusTrendEnum('trend').notNull(),
  },
  (t) => [
    uniqueIndex('focus_measurement_unique').on(t.playerFocusId, t.stream, t.measuredAt),
    index('focus_measurement_focus_idx').on(t.playerFocusId, t.stream),
  ],
);

/**
 * F14, N8. The page a coach sends a parent.
 *
 * This is the one screen designed to leave the account that created it, which
 * makes it the one most worth getting wrong quietly. Three consequences are in
 * the columns. Sharing is an explicit act, so the row does not exist until
 * someone creates it. It can be revoked, so `revokedAt` is checked on every
 * read rather than the row being deleted. And the numbers are frozen into
 * `snapshot` at creation, because a page already in a parent's inbox must not
 * change underneath them.
 */
export const proofSheet = pgTable(
  'proof_sheet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerFocusId: uuid('player_focus_id')
      .notNull()
      .references(() => playerFocus.id, { onDelete: 'cascade' }),
    /** The share secret. Long, random, and the only thing standing between a link and a child's game history. */
    token: text('token').notNull().unique(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('proof_sheet_focus_idx').on(t.playerFocusId)],
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const playerRelations = relations(player, ({ many }) => ({
  games: many(game),
  tournaments: many(tournament),
  reports: many(report),
  focuses: many(playerFocus),
  imports: many(importJob),
}));

export const gameRelations = relations(game, ({ one, many }) => ({
  player: one(player, { fields: [game.playerId], references: [player.id] }),
  importJob: one(importJob, { fields: [game.importJobId], references: [importJob.id] }),
  tournament: one(tournament, {
    fields: [game.tournamentId],
    references: [tournament.id],
  }),
  plies: many(movePly),
  mistakes: many(mistake),
}));

export const tournamentRelations = relations(tournament, ({ one, many }) => ({
  player: one(player, { fields: [tournament.playerId], references: [player.id] }),
  games: many(game),
}));

export const movePlyRelations = relations(movePly, ({ one }) => ({
  game: one(game, { fields: [movePly.gameId], references: [game.id] }),
}));

export const mistakeRelations = relations(mistake, ({ one }) => ({
  game: one(game, { fields: [mistake.gameId], references: [game.id] }),
}));

export const reportRelations = relations(report, ({ one, many }) => ({
  player: one(player, { fields: [report.playerId], references: [player.id] }),
  weaknesses: many(weakness),
}));

export const weaknessRelations = relations(weakness, ({ one }) => ({
  report: one(report, { fields: [weakness.reportId], references: [report.id] }),
}));

export const playerFocusRelations = relations(playerFocus, ({ one, many }) => ({
  player: one(player, { fields: [playerFocus.playerId], references: [player.id] }),
  catalogue: one(focusCatalogue, {
    fields: [playerFocus.catalogueId],
    references: [focusCatalogue.id],
  }),
  measurements: many(focusMeasurement),
  proofSheets: many(proofSheet),
}));

export const focusMeasurementRelations = relations(focusMeasurement, ({ one }) => ({
  focus: one(playerFocus, {
    fields: [focusMeasurement.playerFocusId],
    references: [playerFocus.id],
  }),
}));

export const proofSheetRelations = relations(proofSheet, ({ one }) => ({
  focus: one(playerFocus, { fields: [proofSheet.playerFocusId], references: [playerFocus.id] }),
}));
