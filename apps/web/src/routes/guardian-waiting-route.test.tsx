import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { GuardianWaitingScreen } from './guardian-waiting-route.tsx';

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
});
