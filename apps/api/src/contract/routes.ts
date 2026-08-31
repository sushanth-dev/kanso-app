/**
 * The version one API surface.
 *
 * ADR-0013 makes this REST with an OpenAPI document generated from the Zod
 * schemas, and the frontend consumes it through a generated client. Every route
 * below names the requirement it serves. A route that cannot say which one it
 * serves is a candidate for the backlog rather than the contract.
 *
 * Authentication is not described here. better-auth (ADR-0011) mounts its own
 * routes under `/api/auth/*` and owns its own contract; everything in this file
 * assumes a session cookie and answers 401 without one.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  ActiveFocus,
  ApiError,
  CctScan,
  CheckoutRequest,
  CheckoutResponse,
  Explanation,
  FocusCatalogueEntry,
  GameDetail,
  GameList,
  GameSummary,
  Health,
  ImportJob,
  Me,
  MotifReport,
  PhaseReport,
  Player,
  PracticeAttempt,
  ProofSheet,
  RecordPractice,
  Report,
  SetFocus,
  SetGameColor,
  SharedProofSheet,
  SocraticQuestion,
  StartImport,
  Stream,
  TournamentDecay,
  TournamentDetail,
  TournamentList,
  TransferGap,
  UpdatePlayer,
  Uuid,
} from './schemas.ts';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const error = (description: string) => json(ApiError, description);

/** Every authenticated route can answer these three, so they are declared once. */
const authErrors = {
  400: error('The request body or query failed validation.'),
  401: error('No session.'),
  403: error('The session has no claim on this player.'),
};

// ─── Ops ─────────────────────────────────────────────────────────────────────

export const getHealth = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Ops'],
  summary: 'Is the API up, and can it reach the database',
  description:
    'E3. Public, because a load balancer has no session and a health check behind auth is a health check nothing can call. It answers 200 only when a query reaches the database, and 503 otherwise.',
  security: [],
  responses: {
    200: json(Health, 'The API is up and the database answered.'),
    503: error('The API is up and the database did not answer.'),
  },
});

// ─── Account ─────────────────────────────────────────────────────────────────

export const getMe = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Account'],
  summary: 'The signed-in user and the one player they are',
  description:
    'ST-072. The account is the player, so this returns the account identity and its single chess player.',
  responses: {
    200: json(Me, 'The current session.'),
    401: error('No session.'),
    404: error('No player for this account.'),
  },
});

export const updatePlayer = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['Account'],
  summary: 'Update your player: display name, ratings, and site usernames',
  request: {
    body: json(UpdatePlayer, 'The fields to change.'),
  },
  responses: {
    200: json(Player, 'Updated.'),
    ...authErrors,
    404: error('No such player.'),
    409: error('That username is taken.'),
  },
});

export const confirmGuardian = createRoute({
  method: 'get',
  path: '/guardians/confirm/{token}',
  tags: ['Account'],
  summary: 'Confirm guardian consent from the emailed link',
  /** The consent link is opened by a guardian with no session. */
  security: [],
  description:
    'N7. The unauthenticated route the notice email points at. It records consent exactly once: a valid token for an unconsented link records it, a valid token for an already-consented link is a no-op, and a tampered or expired token answers 404 rather than confirming that a consent request exists.',
  request: {
    params: z.object({
      token: z
        .string()
        .min(32)
        .openapi({ param: { name: 'token', in: 'path' } }),
    }),
  },
  responses: {
    204: { description: 'Consent recorded, or already recorded.' },
    404: error('No such consent request, or the link was tampered with or has expired.'),
  },
});

// ─── Diagnosis ───────────────────────────────────────────────────────────────

export const getTransferGap = createRoute({
  method: 'get',
  path: '/transfer-gap',
  tags: ['Diagnosis'],
  summary: 'The gap between a player’s online and over-the-board rating',
  description:
    'ST-018. Online rapid rating from Chess.com and Lichess, compared against the over-the-board rating (FIDE, else USCF). Fetched and snapshotted on the first view, then re-fetched only on an explicit refresh.',
  request: {
    query: z.object({
      // `refresh=true` is the deliberate re-fetch. A plain string rather than
      // `z.coerce.boolean()`, which turns the string "false" into `true`.
      refresh: z
        .string()
        .optional()
        .openapi({ param: { name: 'refresh', in: 'query' } }),
    }),
  },
  responses: {
    200: json(TransferGap, 'The gap, fetched and snapshotted if needed.'),
    ...authErrors,
    404: error('No such player.'),
  },
});

export const getRoundDecay = createRoute({
  method: 'get',
  path: '/tournaments/{tournamentId}/round-decay',
  tags: ['Diagnosis'],
  summary: 'A player’s average centipawn loss per move, by round',
  description:
    'ST-019. The player’s total evaluation loss per round, divided by the moves they played, so a rising line across rounds is the decay signal. Refuses with 422 when the tournament has fewer than two rounds or any round has fewer than three analysed games.',
  request: {
    params: z.object({
      tournamentId: Uuid.openapi({ param: { name: 'tournamentId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(TournamentDecay, 'The round-by-round decay, with evidence counts.'),
    401: error('No session.'),
    403: error('Not your tournament.'),
    422: error('Not enough evidence to report a trend.'),
  },
});

export const getMotifs = createRoute({
  method: 'get',
  path: '/motifs',
  tags: ['Diagnosis'],
  summary: 'A player’s missed tactical motifs, ranked by cost',
  description:
    'ST-024. Each mistake is attributed to one motif from a closed set, then grouped per motif with the centipawns lost to it, ranked worst first. A motif with fewer than three supporting positions is withheld rather than reported, and the unattributed share is stated, so a thin history reads as thin rather than clean.',
  request: {
    query: z.object({
      stream: Stream.openapi({ param: { name: 'stream', in: 'query' } }),
    }),
  },
  responses: {
    200: json(MotifReport, 'The ranked motifs, with evidence counts.'),
    ...authErrors,
    404: error('No such player.'),
    422: error('No analysed games in this stream.'),
  },
});

export const getPhases = createRoute({
  method: 'get',
  path: '/phase',
  tags: ['Diagnosis'],
  summary: 'A player’s evaluation loss by phase, and where time trouble starts',
  description:
    'ST-025. A player’s centipawn loss attributed to opening, middlegame, and endgame for one stream, with the games behind each phase. For games with clock data, the time-trouble half reports the move where the remaining clock starts driving mistakes; it is unavailable rather than guessed when no games carry a clock.',
  request: {
    query: z.object({
      stream: Stream.openapi({ param: { name: 'stream', in: 'query' } }),
    }),
  },
  responses: {
    200: json(PhaseReport, 'The phase breakdown, with the time-trouble half where it applies.'),
    ...authErrors,
    404: error('No such player.'),
    422: error('No analysed games in this stream.'),
  },
});

// ─── Import ──────────────────────────────────────────────────────────────────

export const startImport = createRoute({
  method: 'post',
  path: '/imports',
  tags: ['Import'],
  summary: 'Import games by username, uploaded PGN, or USCF tournament name',
  description:
    'S1, F1, F2, T1. Every game is tagged with its stream at import. An upload rejects the whole file on one malformed game; a username or tournament import rejects one malformed game and keeps the rest.',
  request: {
    body: json(StartImport, 'What to import.'),
  },
  responses: {
    202: json(ImportJob, 'Queued. Poll the job or watch the event stream.'),
    ...authErrors,
    404: error('No such player.'),
    422: error('No matching account, tournament, or player name for the source.'),
    429: error('The daily import cap is reached.'),
    502: error('The provider fetch failed. Retry later.'),
  },
});

export const getImport = createRoute({
  method: 'get',
  path: '/imports/{importId}',
  tags: ['Import'],
  summary: 'Import job status',
  request: {
    params: z.object({
      importId: Uuid.openapi({ param: { name: 'importId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(ImportJob, 'The job.'),
    401: error('No session.'),
    403: error('Not your job.'),
    404: error('No such job.'),
  },
});

// ─── Games ───────────────────────────────────────────────────────────────────

export const listGames = createRoute({
  method: 'get',
  path: '/games',
  tags: ['Games'],
  summary: 'A player’s games, filtered by stream',
  request: {
    query: z.object({
      stream: Stream.optional().openapi({ param: { name: 'stream', in: 'query' } }),
      // An object id that names something other than the player in the path,
      // so it is claim-checked in the handler before it is used as a filter.
      tournament: Uuid.optional().openapi({ param: { name: 'tournament', in: 'query' } }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .openapi({ param: { name: 'limit', in: 'query' } }),
      // Pages are 1-based rather than a 0-based offset. `z.coerce.number()`
      // turns null into 0, so a lower bound of 0 would quietly accept null and
      // the generated document would have to describe the parameter as
      // nullable. A lower bound of 1 rejects it.
      page: z.coerce
        .number()
        .int()
        .min(1)
        .default(1)
        .openapi({ param: { name: 'page', in: 'query' } }),
    }),
  },
  responses: {
    200: json(GameList, 'The page of games.'),
    ...authErrors,
    404: error('No such player.'),
  },
});

export const getGame = createRoute({
  method: 'get',
  path: '/games/{gameId}',
  tags: ['Games'],
  summary: 'One game with its per-ply evaluations and classified mistakes',
  request: {
    params: z.object({
      gameId: Uuid.openapi({ param: { name: 'gameId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(GameDetail, 'The game.'),
    401: error('No session.'),
    403: error('Not your game.'),
    404: error('No such game.'),
  },
});

export const setGameColor = createRoute({
  method: 'patch',
  path: '/games/{gameId}',
  tags: ['Games'],
  summary: 'Say which side of the board the player was on',
  description:
    'F1. The importer leaves the colour unset when the player’s name matched both tags or neither, and reports how many games it left that way. This is how one of them stops being undecided, and colour is the only field on a game a player can set.',
  request: {
    params: z.object({
      gameId: Uuid.openapi({ param: { name: 'gameId', in: 'path' } }),
    }),
    body: json(SetGameColor, 'The side the player was on.'),
  },
  responses: {
    200: json(GameSummary, 'The game, with the side now set.'),
    400: error('The request body failed validation.'),
    401: error('No session.'),
    403: error('Not your game.'),
    404: error('No such game.'),
  },
});

export const recordPractice = createRoute({
  method: 'post',
  path: '/games/{gameId}/practice',
  tags: ['Games'],
  summary: 'Record one completed practice drill on a mistake',
  description:
    'ST-102. The report names the places behind a weakness; this is the record a player worked on one of them. The body is one completed drill - solved, or the solution was revealed - and the reply is the running tally for the position. Refuses with 422 when the ply is not one of the game’s mistakes, so practice cannot invent a history the analysis never stored. A solved drill also records the day’s activity (ST-103): the streak and XP follow the same once-per-UTC-day rules as reviewing a game, and a revealed or failed drill records none.',
  request: {
    params: z.object({
      gameId: Uuid.openapi({ param: { name: 'gameId', in: 'path' } }),
    }),
    body: json(RecordPractice, 'The outcome of the completed drill.'),
  },
  responses: {
    200: json(PracticeAttempt, 'The running tally for the position.'),
    400: error('The request body failed validation.'),
    401: error('No session.'),
    403: error('Not your game.'),
    404: error('No such game.'),
    422: error('The ply is not one of the game’s mistakes.'),
  },
});

export const deleteGame = createRoute({
  method: 'delete',
  path: '/games/{gameId}',
  tags: ['Games'],
  summary: 'Delete a game the player owns',
  description:
    'ST-089. Removes a game a player imported by mistake, from the wrong PGN or the wrong stream. The delete is scoped to the session’s own player the same way every other game route is, and it removes the game and its per-game analysis rows (evaluations, mistakes) via the existing cascade. Aggregate data a report or focus measurement still supports is untouched, because neither references a game row.',
  request: {
    params: z.object({
      gameId: Uuid.openapi({ param: { name: 'gameId', in: 'path' } }),
    }),
  },
  responses: {
    204: { description: 'Deleted.' },
    401: error('No session.'),
    403: error('Not your game.'),
    404: error('No such game.'),
  },
});

export const queueAnalysis = createRoute({
  method: 'post',
  path: '/games/{gameId}/analysis',
  tags: ['Analysis'],
  summary: 'Queue engine analysis for one game',
  description:
    'F3, N1. Analysis runs on SQS and Lambda (ADR-0014) and takes minutes, so this returns immediately and the result arrives on the event stream.',
  request: {
    params: z.object({
      gameId: Uuid.openapi({ param: { name: 'gameId', in: 'path' } }),
    }),
  },
  responses: {
    202: json(z.object({ gameId: Uuid, status: z.string() }), 'Queued.'),
    401: error('No session.'),
    403: error('Not your game.'),
    404: error('No such game.'),
    409: error('Analysis is already running for this game.'),
    429: error("The plan's analysis cap is reached."),
  },
});

export const analysisEvents = createRoute({
  method: 'get',
  path: '/analysis/events',
  tags: ['Analysis'],
  summary: 'Server-sent events for analysis progress',
  description:
    'ADR-0016, N1. A player is never made to wait on a blank screen. Events carry the game id and its new analysis status; the client refetches the game on completion.',
  responses: {
    200: {
      description: 'An event stream that stays open until the client closes it.',
      content: { 'text/event-stream': { schema: z.string() } },
    },
    401: error('No session.'),
    403: error('Not your player.'),
  },
});

// ─── Tournaments ─────────────────────────────────────────────────────────────

export const listTournaments = createRoute({
  method: 'get',
  path: '/tournaments',
  tags: ['Tournaments'],
  summary: 'The tournaments a player has games in, most recent first',
  description:
    'S5. Each tournament carries its game and analysed counts. A player with no tournaments gets an empty list and a 200, not a 404.',
  responses: {
    200: json(TournamentList, 'The tournaments.'),
    ...authErrors,
    404: error('No such player.'),
  },
});

export const getTournament = createRoute({
  method: 'get',
  path: '/tournaments/{tournamentId}',
  tags: ['Tournaments'],
  summary: 'One tournament with its games in round and board order',
  description:
    'S5. The first endpoint in the API that takes an id which is not a player id, so it resolves the owning player from the tournament id and gates on the same claim rule as every other endpoint. Absence and refusal both answer 403, so naming a tournament id cannot be used to discover which ids are real.',
  request: {
    params: z.object({
      tournamentId: Uuid.openapi({ param: { name: 'tournamentId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(TournamentDetail, 'The tournament, with its games in round order.'),
    401: error('No session.'),
    403: error('Not your tournament.'),
  },
});

// ─── Report ──────────────────────────────────────────────────────────────────

export const getReport = createRoute({
  method: 'get',
  path: '/report',
  tags: ['Report'],
  summary: 'The weakness report for one stream, ranked by rating leak',
  description:
    "F7, F9, S2. Tournament and online games are aggregated separately, so `stream` is required rather than defaulted. A blended report would describe a player who does not exist. ST-098: a `tournamentId` query scopes the report to one tournament's games, with the same floor and refusals.",
  request: {
    query: z.object({
      stream: Stream.openapi({ param: { name: 'stream', in: 'query' } }),
      // ST-098. The report is always the session player's, so a tournament id
      // outside their own rows resolves to an empty scope and the standard
      // 404 rather than a claim-check error.
      tournamentId: Uuid.optional().openapi({ param: { name: 'tournamentId', in: 'query' } }),
    }),
  },
  responses: {
    200: json(Report, 'The report.'),
    ...authErrors,
    404: error('No such player, or no analyzed games in that scope yet.'),
    422: error('Analysed games in the scope are too few for a report.'),
  },
});

// ─── AI ──────────────────────────────────────────────────────────────────────

export const getExplanation = createRoute({
  method: 'get',
  path: '/mistakes/{mistakeId}/explanation',
  tags: ['Coaching'],
  summary: 'Plain-language explanation of one mistake',
  description:
    'ADR-0018. Generated on first read from facts we computed, then served from storage. The model never receives the position, so a wrong explanation traces to a fact we got wrong.',
  request: {
    params: z.object({
      mistakeId: Uuid.openapi({ param: { name: 'mistakeId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(Explanation, 'The explanation.'),
    401: error('No session.'),
    403: error('Not your mistake.'),
    404: error('No such mistake.'),
    502: error('The model call failed. Retry; we never substitute canned text.'),
  },
});

export const getSocraticQuestion = createRoute({
  method: 'get',
  path: '/mistakes/{mistakeId}/question',
  tags: ['Coaching'],
  summary: 'A question about the mistake, instead of the answer',
  request: {
    params: z.object({
      mistakeId: Uuid.openapi({ param: { name: 'mistakeId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(SocraticQuestion, 'The question.'),
    401: error('No session.'),
    403: error('Not your mistake.'),
    404: error('No such mistake.'),
    502: error('The model call failed. Retry; we never substitute canned text.'),
  },
});

export const getCctScan = createRoute({
  method: 'get',
  path: '/mistakes/{mistakeId}/cct',
  tags: ['Coaching'],
  summary: 'Checks, captures and threats available at the mistake position',
  description:
    'ST-080, ADR-0029. Enumerated by ChessOps attack geometry from the position before the mistake, not generated by a model. The same FEN always gives the same scan, so nothing is cached.',
  request: {
    params: z.object({
      mistakeId: Uuid.openapi({ param: { name: 'mistakeId', in: 'path' } }),
    }),
  },
  responses: {
    200: json(CctScan, 'The scan.'),
    401: error('No session.'),
    403: error('Not your mistake.'),
    404: error('No such mistake.'),
  },
});

// ─── Focus ───────────────────────────────────────────────────────────────────

export const listFocuses = createRoute({
  method: 'get',
  path: '/focuses',
  tags: ['Focus'],
  summary: 'The catalogue of focuses the system can measure',
  description:
    'F10, F13. Versioned rather than frozen. It grows when enough unmeasurable coach instructions say the same thing.',
  responses: {
    200: json(z.array(FocusCatalogueEntry), 'The catalogue.'),
    401: error('No session.'),
  },
});

export const getFocus = createRoute({
  method: 'get',
  path: '/focus',
  tags: ['Focus'],
  summary: 'The active focus and its verification trend',
  description:
    'F10, F12. One focus at a time, verified over a rolling window kept per stream, reported with the number of games behind it.',
  responses: {
    200: json(ActiveFocus, 'The active focus.'),
    ...authErrors,
    404: error('No such player, or no active focus.'),
  },
});

export const setFocus = createRoute({
  method: 'put',
  path: '/focus',
  tags: ['Focus'],
  summary: 'Set the active focus, ending the previous one',
  description:
    'F10, F13. A coach instruction we cannot measure is still accepted: it is stored verbatim, shown as active, marked unverified, and paired with a measurable focus so the loop still closes. It is also logged as a candidate for the catalogue.',
  request: {
    body: json(SetFocus, 'The focus to take.'),
  },
  responses: {
    200: json(ActiveFocus, 'The new active focus.'),
    ...authErrors,
    404: error('No such player, or no such catalogue key.'),
  },
});

// ─── Proof sheet ─────────────────────────────────────────────────────────────

export const createProofSheet = createRoute({
  method: 'post',
  path: '/proof-sheets',
  tags: ['Proof sheet'],
  summary: 'Create a shareable before-and-after page',
  description:
    'F14, N5, N8. Sharing is an explicit act, which is why this is a POST and not a flag on the report. The numbers are frozen at creation so a page already in a parent’s inbox does not change underneath them.',
  request: {
    body: json(z.object({ expiresAt: z.iso.datetime().optional() }), 'Optional expiry.'),
  },
  responses: {
    201: json(ProofSheet, 'Created.'),
    ...authErrors,
    404: error('No such player, or no active focus to prove anything about.'),
  },
});

export const listProofSheets = createRoute({
  method: 'get',
  path: '/proof-sheets',
  tags: ['Proof sheet'],
  summary: "A player's live share links",
  description:
    'F14. The current sheets, newest first, excluding revoked and expired ones. The focus screen renders the first so a link survives a reload and can still be revoked.',
  responses: {
    200: json(z.array(ProofSheet), "The player's live sheets."),
    ...authErrors,
    404: error('No such player.'),
  },
});

export const revokeProofSheet = createRoute({
  method: 'delete',
  path: '/proof-sheets/{proofSheetId}',
  tags: ['Proof sheet'],
  summary: 'Revoke a shared page',
  description: 'N8. Revocation is why the row is marked rather than deleted.',
  request: {
    params: z.object({
      proofSheetId: Uuid.openapi({ param: { name: 'proofSheetId', in: 'path' } }),
    }),
  },
  responses: {
    204: { description: 'Revoked. The link stops working immediately.' },
    401: error('No session.'),
    403: error('Not your proof sheet.'),
    404: error('No such proof sheet.'),
  },
});

export const getSharedProofSheet = createRoute({
  method: 'get',
  path: '/shared/proof-sheets/{token}',
  tags: ['Proof sheet'],
  summary: 'Read a shared page by its token',
  /** Answers without a session: it is opened by someone with no account. */
  security: [],
  description:
    'F14, S6. An unauthenticated route, and the only screen designed to leave the account that created it. A revoked or expired token answers 404 rather than 403, so a link cannot be used to confirm a player exists.',
  request: {
    params: z.object({
      token: z
        .string()
        .min(32)
        .openapi({ param: { name: 'token', in: 'path' } }),
    }),
  },
  responses: {
    200: json(SharedProofSheet, 'The page.'),
    404: error('No such page, or it was revoked or has expired.'),
  },
});

// ─── Billing ────────────────────────────────────────────────────────────────

export const createCheckout = createRoute({
  method: 'post',
  path: '/payments/checkout',
  tags: ['Billing'],
  summary: 'Create a Razorpay order for intermediate or pro',
  description:
    'ST-044, ST-074. Creates a Razorpay order and records the checkout. The client opens Razorpay Checkout with the returned order id; confirmation arrives by webhook.',
  request: {
    body: json(CheckoutRequest, 'The plan to purchase.'),
  },
  responses: {
    200: json(CheckoutResponse, 'The order to pay.'),
    400: error('The request body failed validation.'),
    401: error('No session.'),
    502: error('The payment provider could not create an order.'),
  },
});

export const razorpayWebhook = createRoute({
  method: 'post',
  path: '/payments/webhook',
  tags: ['Billing'],
  summary: 'Confirm a payment',
  description:
    'ST-044. Razorpay confirms a capture here. The signature is verified against the raw body before anything is trusted; the response is acknowledged so Razorpay stops retrying.',
  security: [],
  responses: {
    204: { description: 'Recorded, or already recorded.' },
    401: error('The webhook signature did not verify.'),
    404: error('No checkout for this order.'),
  },
});

export const routes = [
  getHealth,
  getMe,
  updatePlayer,
  confirmGuardian,
  startImport,
  getImport,
  listGames,
  getGame,
  setGameColor,
  recordPractice,
  deleteGame,
  queueAnalysis,
  analysisEvents,
  listTournaments,
  getTournament,
  getReport,
  getTransferGap,
  getRoundDecay,
  getMotifs,
  getPhases,
  getExplanation,
  getSocraticQuestion,
  getCctScan,
  listFocuses,
  getFocus,
  setFocus,
  listProofSheets,
  createProofSheet,
  revokeProofSheet,
  getSharedProofSheet,
  createCheckout,
  razorpayWebhook,
] as const;
