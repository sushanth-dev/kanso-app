import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authClient } from '../auth-client.ts';
import { AuthScreen } from './auth-routes.tsx';

vi.mock('../auth-client.ts', () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

const signInEmail = vi.mocked(authClient.signIn.email);
const signUpEmail = vi.mocked(authClient.signUp.email);

function renderSignIn(navigate = vi.fn()) {
  const user = userEvent.setup();
  render(<AuthScreen mode="sign-in" navigate={navigate} />);
  return { user, navigate };
}

describe('AuthScreen sign-in', () => {
  beforeEach(() => {
    signInEmail.mockReset();
    signUpEmail.mockReset();
  });

  test('renders visible labels with the required autocomplete values', () => {
    renderSignIn();
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows the non-enumerating rejection copy for a rejected sign-in', async () => {
    const { user } = renderSignIn();
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, statusText: 'Unauthorized' },
    });

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password was not accepted.',
    );
    expect(signInEmail).toHaveBeenCalledWith({
      email: 'player@example.com',
      password: 'not-the-password',
    });
  });

  test('navigates to /account only when the response has no error', async () => {
    const { user, navigate } = renderSignIn();
    signInEmail.mockResolvedValue({ data: { user: {} }, error: null });

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/account' }));
  });

  test('maps a 429 to the retry-later copy', async () => {
    const { user } = renderSignIn();
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests' },
    });

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again later.',
    );
  });
});

describe('AuthScreen sign-up', () => {
  beforeEach(() => {
    signInEmail.mockReset();
    signUpEmail.mockReset();
  });

  test('renders name and password confirmation with new-password autocomplete', () => {
    render(<AuthScreen mode="sign-up" navigate={vi.fn()} />);
    expect(screen.getByLabelText('Name')).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm password')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeVisible();
  });

  test('rejects a password mismatch locally without calling the auth client', async () => {
    const user = userEvent.setup();
    render(<AuthScreen mode="sign-up" navigate={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  test('trims name and email, never the password, and navigates on success', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });
    render(<AuthScreen mode="sign-up" navigate={navigate} />);

    await user.type(screen.getByLabelText('Name'), '  Player  ');
    await user.type(screen.getByLabelText('Email'), '  player@example.com  ');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith({
        name: 'Player',
        email: 'player@example.com',
        password: 'a-secure-password',
      });
      expect(navigate).toHaveBeenCalledWith({ to: '/account' });
    });
  });
});
