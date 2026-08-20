import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authClient } from '../auth-client.ts';
import { createAppRouter } from '../router.tsx';

vi.mock('../auth-client.ts', () => ({
  authClient: { requestPasswordReset: vi.fn() },
}));

const requestPasswordReset = vi.mocked(authClient.requestPasswordReset);

function renderForgot() {
  const history = createMemoryHistory({ initialEntries: ['/forgot-password'] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

describe('ForgotPasswordRoute', () => {
  beforeEach(() => {
    requestPasswordReset.mockReset();
  });

  test('submits the email and shows the indistinguishable check-your-email copy', async () => {
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
    renderForgot();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledWith({ email: 'alice@example.com' });
    });
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect(screen.getByText(/if this email exists in our system/i)).toBeVisible();
  });

  test('maps a 429 to the retry-later copy', async () => {
    requestPasswordReset.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests' },
    });
    renderForgot();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText(/too many attempts/i)).toBeVisible();
  });
});
