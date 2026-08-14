import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import type { QueryClient } from '@tanstack/react-query';
import {
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { ApiRequestError } from './api/account-api.ts';
import { PageFrame } from './components/page-frame.tsx';
import { meQueryOptions, queryClient } from './query-client.ts';
import { AccountRoute } from './routes/account-route.tsx';
import { SignInRoute, SignUpRoute } from './routes/auth-routes.tsx';
import { GuardianRoute } from './routes/guardian-route.tsx';
import { PlayerEditRoute, PlayerNewRoute } from './routes/player-routes.tsx';

interface RouterContext {
  queryClient: QueryClient;
}

function RootComponent() {
  return (
    <PageFrame>
      <Outlet />
    </PageFrame>
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

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() throws a Response, not an Error.
    throw redirect({ to: '/account' });
  },
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
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- redirect() throws a Response, not an Error.
        throw redirect({ to: '/sign-in' });
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
  component: PlayerEditRoute,
});

const guardianRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: '/players/$playerId/guardian',
  component: GuardianRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  signUpRoute,
  accountRoute.addChildren([accountIndexRoute, playersNewRoute, playerEditRoute, guardianRoute]),
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
  });
}

export const router = createAppRouter({
  history: createBrowserHistory(),
  queryClient,
});
