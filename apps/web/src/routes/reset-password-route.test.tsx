import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authClient } from '../auth-client.ts';
import { createAppRouter } from '../router.tsx';

vi.mock('../auth-client.ts', () => ({
  authClient: { resetPassword: vi.fn() },
}));

const resetPassword = vi.mocked(authClient.resetPassword);

function renderReset(token = 'some-token') {
  const history = createMemoryHistory({ initialEntries: [`/reset-password/${token}`] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

describe('ResetPasswordRoute', () => {
  beforeEach(() => {
    resetPassword.mockReset();
  });

  test('guards a mismatch client-side without calling the API', async () => {
    renderReset();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'different-password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(/passwords do not match/i)).toBeVisible();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  test('resets with the route token and shows the done state', async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    renderReset('the-token');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith({
        newPassword: 'new-password-1',
        token: 'the-token',
      });
    });
    expect(screen.getByRole('heading', { name: 'Password reset' })).toBeVisible();
  });

  test('maps an invalid token to the no-longer-available state', async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { status: 400, statusText: 'Bad Request', code: 'INVALID_TOKEN' },
    });
    renderReset('expired-token');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(
      await screen.findByRole('heading', { name: 'This link is no longer available.' }),
    ).toBeVisible();
  });
  test('maps a 429 to the retry-later copy', async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests' },
    });
    renderReset();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(/too many attempts/i)).toBeVisible();
  });

  test('maps any other refusal to the same try-again copy', async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Internal Server Error' },
    });
    renderReset();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Something went wrong. Try again.')).toBeVisible();
  });

  test('explains a dead link and points at a fresh reset request', async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { status: 400, statusText: 'Bad Request', code: 'INVALID_TOKEN' },
    });
    renderReset('expired-token');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(
      await screen.findByText(
        'The link was used already, expired, or does not match a reset request.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  test('the done state links straight to sign-in and the form keeps native constraints', async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    renderReset();
    const user = userEvent.setup();

    const newPassword = await screen.findByLabelText('New password');
    expect(newPassword).toHaveAttribute('minlength', '8');
    expect(newPassword).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('minlength', '8');

    await user.type(newPassword, 'new-password-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Your password was reset. Sign in with it now.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});
