import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, accountApi } from '../api/account-api.ts';
import { authClient } from '../auth-client.ts';
import { createAppRouter } from '../router.tsx';
import { GuardianWaitingScreen } from './guardian-waiting-route.tsx';

vi.mock('../auth-client.ts', () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

const signOut = vi.mocked(authClient.signOut);

function renderAt(path = '/guardians/waiting') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  // The route only stays put when the session is a minor awaiting consent;
  // any other session is redirected away by the route's own guard.
  vi.spyOn(accountApi, 'getMe').mockRejectedValue(
    new ApiRequestError(403, 'consent_required', undefined, 'Consent required.'),
  );
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GuardianWaitingScreen', () => {
  test('renders the waiting copy and a sign-out button', () => {
    render(<GuardianWaitingScreen signOut={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Waiting for guardian consent' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'A guardian has been emailed and must confirm by opening the link before this account can be used.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  test('shows an error when sign-out fails', async () => {
    const user = userEvent.setup();
    render(<GuardianWaitingScreen signOut={vi.fn().mockRejectedValue(new Error('boom'))} />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign out failed.')).toBeInTheDocument();
  });

  test('the injected sign-out stays on the page after a failure', async () => {
    const user = userEvent.setup();
    render(<GuardianWaitingScreen signOut={vi.fn().mockRejectedValue(new Error('boom'))} />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
});

describe('GuardianWaitingRoute', () => {
  test('keeps its own main landmark and wraps its content in a reveal-in Card', async () => {
    renderAt();

    const main = await screen.findByRole('main');
    expect(main.querySelector('.reveal-in')).toBeInTheDocument();
  });

  test('signing out returns the guardian to sign-in', async () => {
    signOut.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    const { router } = renderAt();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sign-in');
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('a refused sign-out shows the failure and keeps the waiting page', async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 500, statusText: 'error' } });
    const user = userEvent.setup();
    const { router } = renderAt();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign out failed.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/guardians/waiting');
  });
});
