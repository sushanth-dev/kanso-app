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
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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

export const gameSourceEnum = pgEnum('game_source', ['chesscom', 'lichess', 'pgn_upload', 'uscf']);

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

/** ST-074. Beginner is free; intermediate and pro are paid, priced monthly. */
export const tierEnum = pgEnum('tier', ['beginner', 'intermediate', 'pro']);

/** DEBT-016. Why a report has no time-trouble onset: no clocks, or a clocked history too thin to measure. */
export const timeTroubleReasonEnum = pgEnum('time_trouble_reason', [
  'no_clock_data',
  'not_enough_evidence',
]);

/** ST-107. The tier tag inside a progressive resource set: one of each per weakness. */
export const resourceTierEnum = pgEnum('resource_tier', ['beginner', 'intermediate', 'advanced']);

/**
 * ST-150. Verified retirement. `candidate` means the drill pool reached the
 * mastered bucket and the window has not closed yet; `came_back` is active
 * again after a relapse until the group re-masters. `not-yet-verifiable` is
 * never stored, only derived at read time from a too-thin window.
 */
export const patternStateEnum = pgEnum('retirement_state', [
  'active',
  'candidate',
  'retired',
  'came_back',
]);

/** ST-107. An action item is open until the model accepts the player's assessment. */
export const actionItemStatusEnum = pgEnum('action_item_status', ['pending', 'completed']);

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * ST-072. One account is one chess player. The account IS the player: a `user`
 * is the login (better-auth, ADR-0011) and the single `player` row is the chess
 * identity that login owns, 1:1. The unique owner enforces it rather than a
 * convention. The player is born in the sign-up hook, not created by a route.
 *
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

    /**
     * ST-080, amended by ST-105. The activity is a solved practice drill
     * (`POST /games/{gameId}/practice` with `solved: true`) and nothing else:
     * opening a game, or uploading one, never counts. `lastActivityDate` is a
     * calendar date, not a timestamp, so "today" and "yesterday" compare
     * without a timezone-aware walk of a full log; a fuller activity history
     * is deferred until something reads it. `xp` accrues 10 per day counted
     * from the streak trigger, plus the one-off award a verified advice
     * summary pays (ST-105); a leveling formula (level = xp / 100, rounded
     * down, plus one) reads off it rather than being stored.
     */
    currentStreak: integer('current_streak').notNull().default(0),
    xp: integer('xp').notNull().default(0),
    lastActivityDate: date('last_activity_date'),

    /**
     * ST-126. Set by the nudge unsubscribe route and read by the selection
     * query on the same table, so the flag and the query cannot drift apart.
     * Null means the account is still subscribed.
     */
    nudgeUnsubscribedAt: timestamp('nudge_unsubscribed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('player_owner_unique').on(t.ownerUserId)],
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

/** B2, O3, ST-074. Beginner gives one real diagnosis; intermediate and pro give the loop, capped and uncapped. */
export const subscription = pgTable('subscription', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  tier: tierEnum('tier').notNull().default('beginner'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  /** Payment provider is undecided and out of scope until there is something to sell. */
  provider: text('provider'),
  providerRef: text('provider_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR-0039, ST-044, ST-074. One row per checkout. Created when the order is
 * placed with a null payment id, completed when Razorpay confirms the payment
 * by webhook. The payment id is unique, so a replayed webhook finds the row
 * already paid and is a no-op; we never see a card number. `tier` is always
 * `intermediate` or `pro`: beginner needs no checkout.
 */
export const processedPayment = pgTable('processed_payment', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  tier: tierEnum('tier').notNull(),
  /** Minor units: paise for INR. */
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('INR'),
  razorpayOrderId: text('razorpay_order_id').notNull().unique(),
  razorpayPaymentId: text('razorpay_payment_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ST-126. One row per nudge email actually sent: the 7-day exclusion, the
 * 24-hour pacing ledger, and AC 6's record all in one. Only successes are
 * written, so a failed send does not spend the account's week or the
 * provider's daily budget; the run writes the row before sending the next
 * email. The user id is enough to identify the recipient - the email column
 * records the address as it was, since the log outlives nothing else about
 * the account.
 */
export const nudgeSend = pgTable(
  'nudge_send',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('nudge_send_user_sent_idx').on(t.userId, t.sentAt)],
);

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

    /**
     * F6, ST-042. Remaining clock after the move, written at analysis time
     * for any stream whose PGN carries `%clk`; null when the ply has none.
     */
    clockMs: integer('clock_ms'),
    moveTimeMs: integer('move_time_ms'),
  },
  (t) => [uniqueIndex('move_ply_unique').on(t.gameId, t.ply)],
);

/**
 * ST-047, O4. The shared evaluation cache.
 *
 * One row per position the engine has searched to the requested depth, keyed
 * by the full FEN, the engine version, and the depth. A fixed-depth search is
 * deterministic (ADR-0023), so a hit is the same evaluation a fresh search
 * would produce. Only full-depth results are stored: a search stopped by the
 * node ceiling is never cached, which is what keeps the ceiling out of the key
 * and the entry trustworthy.
 *
 * No player or game columns: a FEN is a board position, not a person, and two
 * players sharing an opening share one evaluation without sharing data.
 */
export const evaluationCache = pgTable(
  'evaluation_cache',
  {
    fen: text('fen').notNull(),
    engineVersion: text('engine_version').notNull(),
    depth: smallint('depth').notNull(),
    evalCp: integer('eval_cp'),
    evalMate: smallint('eval_mate'),
    bestMoveUci: text('best_move_uci'),
    nodes: integer('nodes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fen, t.engineVersion, t.depth] })],
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
    /**
     * ST-098. Set on a tournament-scoped report; null on a stream report. A
     * tournament's report dies with the tournament rather than turning into a
     * stream report by accident.
     */
    tournamentId: uuid('tournament_id').references(() => tournament.id, {
      onDelete: 'cascade',
    }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    gamesCovered: integer('games_covered').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    /**
     * F6. The move number where time per move collapses, for online play only.
     * Null on a tournament report by design rather than by accident.
     */
    timeTroubleFromMove: smallint('time_trouble_from_move'),
    /**
     * DEBT-016. Why `timeTroubleFromMove` is null: `no_clock_data` when no
     * game carries a clock, `not_enough_evidence` when the clocked history is
     * too thin. Null when the onset move is present.
     */
    timeTroubleReason: timeTroubleReasonEnum('time_trouble_reason'),
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
    /** ST-099. The model-written advice stored with the report; null keeps the template copy. */
    advice: text('advice'),
  },
  (t) => [uniqueIndex('weakness_rank_unique').on(t.reportId, t.rank)],
);

/**
 * ST-107. One action item of a weakness group's curriculum: one of the three
 * model-assigned resources (one Beginner, one Intermediate, one Advanced)
 * that close the gap the weakness names.
 *
 * Keyed by (player, kind, group key, resource index) rather than by the
 * weakness row's id, because a report regenerates whenever its scope's games
 * change and writes fresh weakness rows; the group key from `groupKeyOf` is
 * the only identity that survives a regeneration. The status flips
 * pending-to-completed when the model accepts the player's assessment, and
 * the completion write only matches a pending row, so a re-submission pays
 * the XP once - the prototype's guard, expressed as an UPDATE ... RETURNING.
 */
export const actionItem = pgTable(
  'action_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    kind: weaknessKindEnum('kind').notNull(),
    /** The stable identity of the weakness group, from `groupKeyOf`. */
    groupKey: text('group_key').notNull(),
    /** Position in the progressive set: 0 Beginner, 1 Intermediate, 2 Advanced. */
    resourceIndex: smallint('resource_index').notNull(),
    tier: resourceTierEnum('tier').notNull(),
    /** The assigned resource, verbatim: a real book chapter or a tactical drill. */
    resource: text('resource').notNull(),
    status: actionItemStatusEnum('status').notNull().default('pending'),
    /** The assessment text the model accepted; null while pending. */
    summary: text('summary'),
    /** The weakness's display label, carried so the assessment prompt can name it. */
    label: text('label').notNull(),
    /** The prototype's deadline: a week to work through the resource. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('action_item_player_unique').on(t.playerId, t.kind, t.groupKey, t.resourceIndex),
    index('action_item_player_idx').on(t.playerId, t.status),
  ],
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

/**
 * ST-117. The assignment link: the share act's second caller (ST-067). The
 * creator records a catalogue focus and the coach's dictated instruction; the
 * token opens a page that shows exactly that payload, and confirming it - a
 * sessioned act - sets the player's active focus through the focus write path.
 * Like the proof sheet: marked revoked rather than deleted, expiring, and the
 * token is the only thing between a forwarded link and the payload. Unlike the
 * proof sheet there is no snapshot: the payload is account-independent, so the
 * read resolves the catalogue focus live and carries nothing else.
 */
export const assignmentLink = pgTable(
  'assignment_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdByPlayerId: uuid('created_by_player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    catalogueId: uuid('catalogue_id')
      .notNull()
      .references(() => focusCatalogue.id),
    /** F13. The coach's own words, kept verbatim. */
    instruction: text('instruction').notNull(),
    /** The share secret. Long, random, and the only thing standing between a forwarded link and the payload. */
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('assignment_link_creator_idx').on(t.createdByPlayerId)],
);

/**
 * ST-118. The game share link: the share act's third caller (ST-067). The
 * token opens one reviewed game - board, moves, mistakes - read-only, with
 * the coach texts excluded so generated prose never leaks and sharing never
 * spends a budget unit. Like the proof sheet: marked revoked rather than
 * deleted, expiring, and the token is the only thing between a forwarded link
 * and the payload. The payload is the live game rows, so there is no snapshot:
 * the game and its analysis are immutable once complete, which is what makes
 * the live read the same thing a snapshot would pin.
 */
export const gameShareLink = pgTable(
  'game_share_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdByPlayerId: uuid('created_by_player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    /** The share secret. Long, random, and the only thing standing between a forwarded link and the payload. */
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('game_share_link_creator_idx').on(t.createdByPlayerId),
    index('game_share_link_game_idx').on(t.gameId),
  ],
);

/**
 * ST-127. The report's share card: the share act's fourth caller (ST-067).
 * The token opens one card - the report's headline leak number and its
 * weakness label, frozen at creation - and nothing else on the account: no
 * games, no opponent names, no identity, no second weakness. The payload is
 * two columns, so the card cannot grow into a profile by accident; the token
 * is the only thing between a forwarded link and those two fields. Marked
 * revoked rather than deleted, expiring, like every share-act row.
 */
export const reportCardLink = pgTable(
  'report_card_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdByPlayerId: uuid('created_by_player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    /** The share secret. Long, random, and the only thing standing between a forwarded link and the payload. */
    token: text('token').notNull().unique(),
    /** F9. The headline figure at creation, in rating points. */
    ratingLeak: integer('rating_leak').notNull(),
    /** The headline weakness's display label at creation. */
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('report_card_link_creator_idx').on(t.createdByPlayerId)],
);

/**
 * ST-153. The priming token: the credential the browser extension presents
 * to the pre-game brief endpoint. Unlike the share tokens, which open one
 * frozen page, this token keeps serving whatever the brief currently holds,
 * so it is a long-lived credential and the surface around it treats it as
 * one: shown in full once at creation, stored hashed, revocable from
 * settings, and one live token per player (creating a new one revokes the
 * old, so rotation retires a leaked token). Marked revoked rather than
 * deleted, the share-act precedent.
 */
export const primingToken = pgTable(
  'priming_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdByPlayerId: uuid('created_by_player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    /** The sha-256 of the bearer secret. The raw secret is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('priming_creator_idx').on(t.createdByPlayerId)],
);

/**
 * ST-153. The fixed-window rate-limit bucket for the brief endpoint. Keyed
 * on the token hash so a leaked token cannot be swept faster than the window
 * allows, and counted in the database because the API runs more than one
 * instance; an in-memory map would multiply the limit by the instance count.
 */
export const rateLimitBucket = pgTable('rate_limit_bucket', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
});

// ─── Practice ────────────────────────────────────────────────────────────────

/**
 * ST-106. The pool of drill puzzles, imported once per environment from the
 * Lichess puzzle database (CSV dump, CC0). Rows are shared by every player,
 * the same shape the prototype kept in `available_puzzles`. `moves` is the
 * dump's space-separated UCI line: the first move is the opponent's setup,
 * the rest are the solution, the player's moves alternating with the forced
 * replies. The import script filters by theme, rating band, deviation and
 * popularity, validates every kept row against chess.js, and caps rows per
 * theme; nothing in the application writes to this table.
 */
export const puzzle = pgTable(
  'puzzle',
  {
    /** The dump's puzzle id, stable across Lichess's monthly regenerations. */
    lichessId: text('lichess_id').primaryKey(),
    /** The position before the opponent's setup move, exactly as the dump stores it. */
    fen: text('fen').notNull(),
    moves: text('moves').notNull(),
    rating: integer('rating').notNull(),
    /** The dump's theme slugs, camelCase as Lichess writes them (`hangingPiece`). */
    themes: text('themes').array().notNull(),
    /**
     * ST-122. The dump's deepest opening tag (`Scandinavian_Defense_Main_Line`),
     * null when the source game had no opening name. The drill's opening rungs
     * prefix-match an ECO family against it; the import script is the only
     * writer, beside the seed migration.
     */
    opening: text('opening'),
  },
  (t) => [
    index('puzzle_themes_idx').using('gin', t.themes),
    index('puzzle_rating_idx').on(t.rating),
  ],
);

/**
 * ST-106. The record that a player completed a drill on one pool puzzle,
 * replacing ST-102's replay-scoped `practice_attempt`. `attempts` counts
 * completed drills - solved or revealed - and `solved` is sticky, so a puzzle
 * solved once stays solved even if a later attempt was revealed. The kind and
 * the group key from `groupKeyOf` ride the row so the report can show what a
 * weakness group has been drilled with from one indexed read, and they
 * survive report regeneration for the same reason `advice_progress` keys on
 * the group rather than the weakness row's id.
 */
export const puzzleAttempt = pgTable(
  'puzzle_attempt',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    puzzleId: text('puzzle_id')
      .notNull()
      .references(() => puzzle.lichessId),
    kind: weaknessKindEnum('kind').notNull(),
    /** The stable identity of the weakness group, from `groupKeyOf`. */
    groupKey: text('group_key').notNull(),
    /** Completed drills recorded against this puzzle. */
    attempts: integer('attempts').notNull().default(0),
    /** True when any attempt on this puzzle was solved. */
    solved: boolean('solved').notNull().default(false),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * ST-124. The review ladder: 0 failed or fresh, then 1/2/3 at two, seven
     * and thirty days. A solve advances one rung, capped at 3 - a solved
     * level-3 puzzle returns every thirty days; a reveal or a fail drops
     * back to 0, due immediately.
     */
    reviewLevel: smallint('review_level').notNull().default(0),
    /** When the puzzle returns for review; level 0 rows are due immediately. */
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * ST-107. When the deal assigned this puzzle, null for a row written by
     * an old build. Assignment is the dedupe: a row exists the moment the
     * drill deals the puzzle, not only when a drill is recorded, so an
     * abandoned session never deals the same puzzles again.
     */
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    /**
     * ST-124. The last review solve on this row: a completed, solved drill on
     * a puzzle that was due on the ladder (level 1-3 with `next_review_at`
     * passed). The ten-a-day review cap counts the rows whose UTC date is
     * today, the same calendar the streak reads. Null when never reviewed.
     */
    reviewSolvedAt: timestamp('review_solved_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.puzzleId] }),
    index('puzzle_attempt_group_idx').on(t.playerId, t.kind, t.groupKey),
    index('puzzle_attempt_review_idx').on(t.playerId, t.nextReviewAt),
  ],
);

/**
 * ST-150. The verified-retirement state of one weakness group, per stream.
 *
 * Keyed by (player, kind, group key, stream) - the group identity from
 * `groupKeyOf`, the only one that survives report regeneration - so a
 * regeneration cannot touch it and a relapse is caught per stream, the
 * way every verification the product makes is per stream. The state
 * machine is: mastered pool promotes to `candidate`; the verification
 * window completing with zero new instances retires it; the first new
 * instance after that flips to `came_back`, which is active again until
 * the group re-masters. `not-yet-verifiable` is never stored: a
 * candidate whose stream window is thinner than the floor answers it at
 * read time, so the answer cannot go stale.
 */
export const patternState = pgTable(
  'pattern_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    kind: weaknessKindEnum('kind').notNull(),
    /** The stable identity of the weakness group, from `groupKeyOf`. */
    groupKey: text('group_key').notNull(),
    stream: streamEnum('stream').notNull(),
    /** The group's display label, carried at write time for alert copy. */
    label: text('label').notNull(),
    state: patternStateEnum('state').notNull().default('candidate'),
    masteredAt: timestamp('mastered_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    cameBackAt: timestamp('came_back_at', { withTimezone: true }),
    /** The game whose analysis triggered the relapse; one alert per relapse. */
    lastAlertGameId: uuid('last_alert_game_id').references(() => game.id, {
      onDelete: 'set null',
    }),
    /**
     * ST-152. How many times this retired group has come back. The latest
     * relapse lives in `cameBackAt`/`lastAlertGameId`; the count is what
     * survives re-mastery, so the board's history outlives the fields that
     * name the most recent relapse.
     */
    relapses: integer('relapses').notNull().default(0),
  },
  (t) => [
    uniqueIndex('pattern_state_group_unique').on(t.playerId, t.kind, t.groupKey, t.stream),
    index('pattern_state_player_idx').on(t.playerId, t.state),
  ],
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const playerRelations = relations(player, ({ many }) => ({
  games: many(game),
  tournaments: many(tournament),
  reports: many(report),
  focuses: many(playerFocus),
  imports: many(importJob),
}));

export const puzzleAttemptRelations = relations(puzzleAttempt, ({ one }) => ({
  player: one(player, { fields: [puzzleAttempt.playerId], references: [player.id] }),
}));

export const patternStateRelations = relations(patternState, ({ one }) => ({
  player: one(player, { fields: [patternState.playerId], references: [player.id] }),
  lastAlertGame: one(game, {
    fields: [patternState.lastAlertGameId],
    references: [game.id],
  }),
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
