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
  CreatePlayer,
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
  ProofSheet,
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

const playerParams = z.object({
  playerId: Uuid.openapi({ param: { name: 'playerId', in: 'path' } }),
});

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
  summary: 'The signed-in user, the players they play as, and the players they pay for',
  description:
    'B4. The person paying and the person playing are different people, so this returns two lists rather than one.',
  responses: {
    200: json(Me, 'The current session.'),
    401: error('No session.'),
  },
});

export const createPlayer = createRoute({
  method: 'post',
  path: '/players',
  tags: ['Account'],
  summary: 'Create a chess identity',
  request: { body: json(CreatePlayer, 'The new player.') },
  responses: {
    201: json(Player, 'Created.'),
    ...authErrors,
  },
});

export const updatePlayer = createRoute({
  method: 'patch',
  path: '/players/{playerId}',
  tags: ['Account'],
  summary: 'Update ratings and site usernames',
  request: {
    params: playerParams,
    body: json(UpdatePlayer, 'The fields to change.'),
  },
  responses: {
    200: json(Player, 'Updated.'),
    ...authErrors,
    404: error('No such player.'),
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
  path: '/players/{playerId}/transfer-gap',
  tags: ['Diagnosis'],
  summary: 'The gap between a player’s online and over-the-board rating',
  description:
    'ST-018. Online rapid rating from Chess.com and Lichess, compared against the over-the-board rating (FIDE, else USCF). Fetched and snapshotted on the first view, then re-fetched only on an explicit refresh.',
  request: {
    params: playerParams,
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
  path: '/players/{playerId}/motifs',
  tags: ['Diagnosis'],
  summary: 'A player’s missed tactical motifs, ranked by cost',
  description:
    'ST-024. Each mistake is attributed to one motif from a closed set, then grouped per motif with the centipawns lost to it, ranked worst first. A motif with fewer than three supporting positions is withheld rather than reported, and the unattributed share is stated, so a thin history reads as thin rather than clean.',
  request: {
    params: playerParams,
    query: z.object({
      stream: Stream.openapi({ param: { name: 'stream', in: 'query' } }),
    }),
  },
  responses: {
    200: json(MotifReport, 'The ranked motifs, with evidence counts.'),
    ...authErrors,
    422: error('No analysed games in this stream.'),
  },
});

export const getPhases = createRoute({
  method: 'get',
  path: '/players/{playerId}/phase',
  tags: ['Diagnosis'],
  summary: 'A player’s evaluation loss by phase, and where time trouble starts',
  description:
    'ST-025. A player’s centipawn loss attributed to opening, middlegame, and endgame for one stream, with the games behind each phase. For online games with clock data, the time-trouble half reports the move where the remaining clock starts driving mistakes; it is unavailable rather than guessed on tournament games or games without a clock.',
  request: {
    params: playerParams,
    query: z.object({
      stream: Stream.openapi({ param: { name: 'stream', in: 'query' } }),
    }),
  },
  responses: {
    200: json(PhaseReport, 'The phase breakdown, with the time-trouble half where it applies.'),
    ...authErrors,
    422: error('No analysed games in this stream.'),
  },
});

// ─── Import ──────────────────────────────────────────────────────────────────

export const startImport = createRoute({
  method: 'post',
  path: '/players/{playerId}/imports',
  tags: ['Import'],
  summary: 'Import games by username, uploaded PGN, or USCF tournament name',
  description:
    'S1, F1, F2, T1. Every game is tagged with its stream at import. An upload rejects the whole file on one malformed game; a username or tournament import rejects one malformed game and keeps the rest.',
  request: {
    params: playerParams,
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
  path: '/players/{playerId}/games',
  tags: ['Games'],
  summary: 'A player’s games, filtered by stream',
  request: {
    params: playerParams,
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
    429: error('The free tier analysis cap is reached.'),
  },
});

export const analysisEvents = createRoute({
  method: 'get',
  path: '/players/{playerId}/analysis/events',
  tags: ['Analysis'],
  summary: 'Server-sent events for analysis progress',
  description:
    'ADR-0016, N1. A player is never made to wait on a blank screen. Events carry the game id and its new analysis status; the client refetches the game on completion.',
  request: { params: playerParams },
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
  path: '/players/{playerId}/tournaments',
  tags: ['Tournaments'],
  summary: 'The tournaments a player has games in, most recent first',
  description:
    'S5. Each tournament carries its game and analysed counts. A player with no tournaments gets an empty list and a 200, not a 404.',
  request: { params: playerParams },
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
  path: '/players/{playerId}/report',
  tags: ['Report'],
  summary: 'The weakness report for one stream, ranked by rating leak',
  description:
    'F7, F9, S2. Tournament and online games are aggregated separately, so `stream` is required rather than defaulted. A blended report would describe a player who does not exist.',
  request: {
    params: playerParams,
    query: z.object({
      stream: Stream.openapi({ param: { name: 'stream', in: 'query' } }),
    }),
  },
  responses: {
    200: json(Report, 'The report.'),
    ...authErrors,
    404: error('No such player, or no analyzed games in that stream yet.'),
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
  path: '/players/{playerId}/focus',
  tags: ['Focus'],
  summary: 'The active focus and its verification trend',
  description:
    'F10, F12. One focus at a time, verified over a rolling window kept per stream, reported with the number of games behind it.',
  request: { params: playerParams },
  responses: {
    200: json(ActiveFocus, 'The active focus.'),
    ...authErrors,
    404: error('No such player, or no active focus.'),
  },
});

export const setFocus = createRoute({
  method: 'put',
  path: '/players/{playerId}/focus',
  tags: ['Focus'],
  summary: 'Set the active focus, ending the previous one',
  description:
    'F10, F13. A coach instruction we cannot measure is still accepted: it is stored verbatim, shown as active, marked unverified, and paired with a measurable focus so the loop still closes. It is also logged as a candidate for the catalogue.',
  request: {
    params: playerParams,
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
  path: '/players/{playerId}/proof-sheets',
  tags: ['Proof sheet'],
  summary: 'Create a shareable before-and-after page',
  description:
    'F14, N5, N8. Sharing is an explicit act, which is why this is a POST and not a flag on the report. The numbers are frozen at creation so a page already in a parent’s inbox does not change underneath them.',
  request: {
    params: playerParams,
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
  path: '/players/{playerId}/proof-sheets',
  tags: ['Proof sheet'],
  summary: "A player's live share links",
  description:
    'F14. The current sheets, newest first, excluding revoked and expired ones. The focus screen renders the first so a link survives a reload and can still be revoked.',
  request: { params: playerParams },
  responses: {
    200: json(z.array(ProofSheet), "The player's live sheets."),
    ...authErrors,
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

export const routes = [
  getHealth,
  getMe,
  createPlayer,
  updatePlayer,
  confirmGuardian,
  startImport,
  getImport,
  listGames,
  getGame,
  setGameColor,
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
  listFocuses,
  getFocus,
  setFocus,
  listProofSheets,
  createProofSheet,
  revokeProofSheet,
  getSharedProofSheet,
] as const;
