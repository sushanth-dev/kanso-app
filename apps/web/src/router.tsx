import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  redirect,
  useLocation,
  useRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { ApiRequestError } from './api/account-api.ts';
import { PageFrame } from './components/page-frame.tsx';
import { StatusMessageProvider } from './components/status-message.tsx';
import { RouteError } from './components/route-error.tsx';
import { meQueryOptions, queryClient } from './query-client.ts';
import { AccountRoute } from './routes/account-route.tsx';
import { SignInRoute, SignUpRoute } from './routes/auth-routes.tsx';
import { GameReviewRoute } from './routes/game-review-route.tsx';
import { GamesRoute } from './routes/games-route.tsx';
import { FocusRoute } from './routes/focus-route.tsx';
import { GuardianConfirmRoute } from './routes/guardian-confirm-route.tsx';
import { GuardianWaitingRoute } from './routes/guardian-waiting-route.tsx';
import { ImportRoute } from './routes/import-route.tsx';
import { LandingRoute } from './routes/landing-route.tsx';
import { PlayerEditRoute, PlayerNewRoute } from './routes/player-routes.tsx';
import { ProofSheetRoute } from './routes/proof-sheet-route.tsx';
import { ReportRoute } from './routes/report-route.tsx';
import { SharedProofSheetRoute } from './routes/shared-proof-sheet-route.tsx';
import { UpgradeRoute } from './routes/upgrade-route.tsx';
import { ForgotPasswordRoute } from './routes/forgot-password-route.tsx';
import { ResetPasswordRoute } from './routes/reset-password-route.tsx';

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
  if (
    pathname === '/' ||
    pathname.startsWith('/shared/proof-sheets/') ||
    pathname.startsWith('/guardians/')
  ) {
    return outlet;
  }
  return (
    <StatusMessageProvider>
      <PageFrame>{outlet}</PageFrame>
    </StatusMessageProvider>
  );
}

function DefaultErrorComponent() {
  const router = useRouter();
  return (
    <div role="alert" className="space-y-3">
      <Heading level={1}>Something went wrong</Heading>
      <p className="text-muted">We couldn't load this page. Please try again.</p>
      <Button
        label="Retry"
        variant="primary"
        onClick={() => {
          void router.invalidate();
        }}
      />
    </div>
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

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
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

const accountIndexRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/',
  component: AccountRoute,
});

const playersNewRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/new',
  component: PlayerNewRoute,
});

const playerEditRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/edit',
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me.players.some((owned) => owned.id === params.playerId)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: PlayerEditRoute,
});

const reportRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/report',
  validateSearch: (search: Record<string, unknown>) =>
    search.stream === 'online' ? { stream: 'online' as const } : { stream: 'tournament' as const },
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    const owned = me.players.some((player) => player.id === params.playerId);
    if (!owned) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: ReportRoute,
});

const focusRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/focus',
  validateSearch: (search: Record<string, unknown>) =>
    search.stream === 'online' ? { stream: 'online' as const } : { stream: 'tournament' as const },
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me.players.some((player) => player.id === params.playerId)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: FocusRoute,
});

const proofSheetRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/proof-sheet',
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    const owned = me.players.some((player) => player.id === params.playerId);
    if (!owned) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: ProofSheetRoute,
});

const importRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/import',
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    const owned = me.players.some((player) => player.id === params.playerId);
    if (!owned) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: ImportRoute,
});

const upgradeRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/upgrade',
  component: UpgradeRoute,
});

const gamesRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/games',
  validateSearch: (search: Record<string, unknown>) =>
    search.stream === 'online' ? { stream: 'online' as const } : { stream: 'tournament' as const },
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me.players.some((player) => player.id === params.playerId)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: GamesRoute,
});

const gameReviewRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/games/$gameId',
  beforeLoad: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!me.players.some((player) => player.id === params.playerId)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
      throw notFound();
    }
  },
  component: GameReviewRoute,
});

const sharedProofSheetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shared/proof-sheets/$token',
  component: SharedProofSheetRoute,
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
    throw redirect({ to: '/account' });
  },
  component: GuardianWaitingRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  signUpRoute,
  accountRoute.addChildren([
    accountIndexRoute,
    playersNewRoute,
    playerEditRoute,
    reportRoute,
    focusRoute,
    proofSheetRoute,
    importRoute,
    gamesRoute,
    gameReviewRoute,
    upgradeRoute,
  ]),
  sharedProofSheetRoute,
  guardianConfirmRoute,
  guardianWaitingRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
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
