import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useLocation,
  useRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { ApiRequestError } from './api/account-api.ts';
import { AnnouncementBanner } from './components/announcement-banner.tsx';
import { NotFound } from './components/not-found.tsx';
import { PageFrame } from './components/page-frame.tsx';
import { StatusMessageProvider } from './components/status-message.tsx';
import { RouteError } from './components/route-error.tsx';
import { meQueryOptions, queryClient } from './query-client.ts';
import type { WeaknessKind } from './api/diagnosis-api.ts';
import { SignInRoute, SignUpRoute } from './routes/auth-routes.tsx';
import { GameReviewRoute } from './routes/game-review-route.tsx';
import { FinishGameRoute } from './routes/finish-game-route.tsx';
import { SharedProofSheetRoute } from './routes/shared-proof-sheet-route.tsx';
import { SharedAssignmentRoute } from './routes/shared-assignment-route.tsx';
import { SharedGameRoute } from './routes/shared-game-route.tsx';
import { SharedCardRoute } from './routes/shared-card-route.tsx';
import { FocusRoute } from './routes/focus-route.tsx';
import { GuardianConfirmRoute } from './routes/guardian-confirm-route.tsx';
import { GuardianWaitingRoute } from './routes/guardian-waiting-route.tsx';
import { DebriefRoute } from './routes/debrief-route.tsx';
import { ImportRoute } from './routes/import-route.tsx';
import { NudgeUnsubscribeRoute } from './routes/nudge-unsubscribe-route.tsx';
import { LandingRoute } from './routes/landing-route.tsx';
import { PlayerEditRoute } from './routes/player-routes.tsx';
import { ProofSheetRoute } from './routes/proof-sheet-route.tsx';
import { PracticeRoute } from './routes/practice-route.tsx';
import { SettingsRoute } from './routes/settings-route.tsx';
import { ReportRoute } from './routes/report-route.tsx';
import { GamesRoute } from './routes/games-route.tsx';
import { UpgradeRoute } from './routes/upgrade-route.tsx';
import { TournamentsRoute } from './routes/tournaments-route.tsx';
import { TournamentDetailRoute } from './routes/tournament-detail-route.tsx';
import { TransferGapRoute } from './routes/transfer-gap-route.tsx';
import { PuzzlesRoute } from './routes/puzzles-route.tsx';
import { CurriculumRoute } from './routes/curriculum-route.tsx';
import { ForgotPasswordRoute } from './routes/forgot-password-route.tsx';
import { ResetPasswordRoute } from './routes/reset-password-route.tsx';
import { AboutRoute, ContactRoute, PrivacyRoute, TermsRoute } from './routes/legal-routes.tsx';

interface RouterContext {
  queryClient: QueryClient;
}

function RootComponent() {
  const pathname = useLocation({ select: (location) => location.pathname });
  // The route transition was dropped: the `motion` AnimatePresence exit left
  // the entering surface stuck at near-zero opacity, and a keyed CSS wrapper
  // remounts the outlet and fires a spurious `/me` 401 during sign-out. The
  // surface-level motion (`.stagger-in`, `.press`, `.reveal-in`) remains.
  const outlet = <Outlet />;
  // The landing page and the shared page are public and render outside the
  // authenticated shell. The landing page carries its own header and footer.
  // The nudge unsubscribe link (ST-126) joins them: it is opened from an email
  // with no session. The four policy pages (ST-165) join them too: a parent
  // reading the privacy page has no session either.
  if (
    pathname === '/' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/about' ||
    pathname === '/contact' ||
    pathname.startsWith('/shared/proof-sheets/') ||
    pathname.startsWith('/shared/assignments/') ||
    pathname.startsWith('/shared/games/') ||
    pathname.startsWith('/shared/cards/') ||
    pathname.startsWith('/guardians/') ||
    pathname.startsWith('/nudge/')
  ) {
    return outlet;
  }
  return (
    <StatusMessageProvider>
      <AnnouncementBanner />
      <PageFrame>{outlet}</PageFrame>
    </StatusMessageProvider>
  );
}

function DefaultErrorComponent() {
  const router = useRouter();
  return (
    <EmptyState
      title="Something went wrong"
      description="We couldn't load this page. Please try again."
      headingLevel={1}
      actions={
        <Button
          label="Retry"
          variant="primary"
          onClick={() => {
            void router.invalidate();
          }}
        />
      }
    />
  );
}

function PendingComponent() {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className="space-y-3">
      <div className="h-5 w-40 rounded-control bg-sunken" />
      <div className="h-4 w-64 rounded-control bg-sunken" />
    </div>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingRoute,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: SignInRoute,
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  component: SignUpRoute,
});

// ST-165. The four policy pages are public and render outside the shell, so a
// visitor with no account can read them, and so the footer can reach them.
const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/privacy',
  component: PrivacyRoute,
});

const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/terms',
  component: TermsRoute,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutRoute,
});

const contactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contact',
  component: ContactRoute,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'account',
  errorComponent: RouteError,
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() throws a Response, not an Error.
        throw redirect({ to: '/sign-in' });
      }
      if (error instanceof ApiRequestError && error.code === 'consent_required') {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() throws a Response, not an Error.
        throw redirect({ to: '/guardians/waiting' });
      }
      throw error;
    }
  },
});

const playerEditRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/player',
  component: PlayerEditRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/settings',
  component: SettingsRoute,
});

const reportRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/report',
  validateSearch: (search: Record<string, unknown>) => {
    // ST-093: the current upload's game ids scope the analysing counter to that
    // batch. Absent (a direct visit) the counter covers every active game.
    const gameIds =
      typeof search.gameIds === 'string'
        ? [search.gameIds]
        : Array.isArray(search.gameIds)
          ? search.gameIds.filter((v): v is string => typeof v === 'string')
          : undefined;
    // ST-096: the tournament the current upload attached to, so the report
    // page's tournament card shows it rather than the most recent one. It only
    // ever selects a card from the caller's own tournaments list.
    const tournamentId = typeof search.tournamentId === 'string' ? search.tournamentId : undefined;
    return {
      stream: search.stream === 'online' ? ('online' as const) : ('tournament' as const),
      ...(gameIds !== undefined ? { gameIds } : {}),
      ...(tournamentId !== undefined ? { tournamentId } : {}),
    };
  },
  component: ReportRoute,
});

const focusRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/focus',
  validateSearch: (search: Record<string, unknown>) =>
    search.stream === 'online' ? { stream: 'online' as const } : { stream: 'tournament' as const },
  component: FocusRoute,
});

const proofSheetRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/proof-sheet',
  component: ProofSheetRoute,
});

const importRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/import',
  component: ImportRoute,
});

// ST-115. The debrief: where a tournament import ends. Three anchored
// sections - the batch's report, the one focus, the first drill - composing
// the surfaces that already exist. Reached from the import, never from the
// nav; a direct visit without a batch points back at the import.
const debriefRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/debrief',
  validateSearch: (search: Record<string, unknown>) => {
    const gameIds =
      typeof search.gameIds === 'string'
        ? [search.gameIds]
        : Array.isArray(search.gameIds)
          ? search.gameIds.filter((v): v is string => typeof v === 'string')
          : undefined;
    const tournamentId = typeof search.tournamentId === 'string' ? search.tournamentId : undefined;
    const gameId = typeof search.gameId === 'string' ? search.gameId : undefined;
    return {
      ...(gameIds !== undefined ? { gameIds } : {}),
      ...(tournamentId !== undefined ? { tournamentId } : {}),
      ...(gameId !== undefined ? { gameId } : {}),
    };
  },
  component: DebriefRoute,
});

const upgradeRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/upgrade',
  component: UpgradeRoute,
});

const gamesRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/games',
  validateSearch: (search: Record<string, unknown>) =>
    search.stream === 'online' ? { stream: 'online' as const } : { stream: 'tournament' as const },
  component: GamesRoute,
});

const gameReviewRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/games/$gameId',
  // ST-100. The ply a report evidence link deep-links to. Absent or invalid,
  // the review opens at the first recorded mistake as before.
  validateSearch: (search: Record<string, unknown>): { ply?: number } => {
    const ply =
      typeof search.ply === 'number' && Number.isInteger(search.ply) && search.ply >= 1
        ? search.ply
        : undefined;
    return ply !== undefined ? { ply } : {};
  },
  component: GameReviewRoute,
});
// ST-106. The puzzle drill a report card or a review mistake sends the player
// to: one weakness group's deal, labelled by the surface that linked here.
// ST-158. The finish-your-own-game session: the game review's mistake card
// links here with the ply; the screen replays the stored continuation and
// falls back to the engine-reply endpoint once the player leaves the rails.
const finishGameRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/games/$gameId/finish',
  validateSearch: (search: Record<string, unknown>): { ply?: number } => {
    const ply =
      typeof search.ply === 'number' && Number.isInteger(search.ply) && search.ply >= 1
        ? search.ply
        : undefined;
    return ply !== undefined ? { ply } : {};
  },
  component: FinishGameRoute,
});

const practiceRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/practice',
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    kind: WeaknessKind | null;
    group: string | null;
    label: string | null;
    stream: 'tournament' | 'online';
  } => {
    const kind =
      search.kind === 'motif' ||
      search.kind === 'phase' ||
      search.kind === 'opening' ||
      search.kind === 'time_trouble'
        ? search.kind
        : null;
    const group =
      typeof search.group === 'string' && search.group.length > 0 && search.group.length <= 64
        ? search.group
        : null;
    const label =
      typeof search.label === 'string' && search.label.length > 0 && search.label.length <= 120
        ? search.label
        : null;
    const stream = search.stream === 'online' ? ('online' as const) : ('tournament' as const);
    return { kind, group, label, stream };
  },
  component: PracticeRoute,
});

// ST-107. The puzzles page: what is pending, what is coming up for review,
// what is mastered. The drill route stays the place puzzles are solved.
const puzzlesRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/puzzles',
  component: PuzzlesRoute,
});

// ST-107. The training curriculum: every assigned action item, each closed
// by its own assessment.
const curriculumRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/curriculum',
  component: CurriculumRoute,
});

const tournamentsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/tournaments',
  component: TournamentsRoute,
});

const tournamentDetailRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/tournaments/$tournamentId',
  component: TournamentDetailRoute,
});

const transferGapRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/transfer-gap',
  component: TransferGapRoute,
});

const sharedProofSheetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/proof-sheets/$token',
  component: SharedProofSheetRoute,
});

// ST-117. The assignment link a coach's instruction rides in on: public like
// the shared proof sheet, because it is opened before anyone signs in.
const sharedAssignmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/assignments/$token',
  component: SharedAssignmentRoute,
});

// ST-118. A reviewed game's share link: public like the other shared pages,
// because it is opened before anyone signs in.
const sharedGameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/games/$token',
  component: SharedGameRoute,
});

// ST-127. The report's share card: public like the other shared pages,
// because it is opened before anyone signs in.
const sharedCardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/cards/$token',
  component: SharedCardRoute,
});

const guardianConfirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guardians/confirm/$token',
  component: GuardianConfirmRoute,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordRoute,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password/$token',
  component: ResetPasswordRoute,
});

// ST-126. The nudge email's unsubscribe link: public, like the consent
// confirm, because it is opened from an email with no session.
const nudgeUnsubscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nudge/unsubscribe/$token',
  component: NudgeUnsubscribeRoute,
});

const guardianWaitingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guardians/waiting',
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() throws a Response, not an Error.
        throw redirect({ to: '/sign-in' });
      }
      if (error instanceof ApiRequestError && error.code === 'consent_required') {
        return;
      }
      throw error;
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() throws a Response, not an Error.
    throw redirect({ to: '/settings' });
  },
  component: GuardianWaitingRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  signUpRoute,
  privacyRoute,
  termsRoute,
  aboutRoute,
  contactRoute,
  accountRoute.addChildren([
    playerEditRoute,
    settingsRoute,
    reportRoute,
    practiceRoute,
    puzzlesRoute,
    curriculumRoute,
    focusRoute,
    proofSheetRoute,
    importRoute,
    debriefRoute,
    gamesRoute,
    gameReviewRoute,
    finishGameRoute,
    tournamentsRoute,
    tournamentDetailRoute,
    transferGapRoute,
    upgradeRoute,
  ]),
  sharedProofSheetRoute,
  sharedAssignmentRoute,
  sharedGameRoute,
  sharedCardRoute,
  guardianConfirmRoute,
  guardianWaitingRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  nudgeUnsubscribeRoute,
]);

export interface CreateAppRouterOptions {
  history: RouterHistory;
  queryClient: QueryClient;
}

export function createAppRouter({
  history,
  queryClient: routerQueryClient,
}: CreateAppRouterOptions) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient: routerQueryClient },
    defaultErrorComponent: DefaultErrorComponent,
    defaultPendingComponent: PendingComponent,
    defaultNotFoundComponent: NotFound,
  });
}

export const router = createAppRouter({
  history: createBrowserHistory(),
  queryClient,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
