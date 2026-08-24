import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { authClient } from '../auth-client.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
import { createAppRouter } from '../router.tsx';
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

function renderAuth(mode: 'sign-in' | 'sign-up', navigate = vi.fn()) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  const router = createAppRouter({ history: createMemoryHistory(), queryClient });
  render(
    <RouterContextProvider router={router}>
      <AuthScreen mode={mode} navigate={navigate} queryClient={queryClient} />
    </RouterContextProvider>,
  );
  return { user, navigate, queryClient };
}

const renderSignIn = (navigate = vi.fn()) => renderAuth('sign-in', navigate);
const renderSignUp = (navigate = vi.fn()) => renderAuth('sign-up', navigate);

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
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/sign-up');
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

  test('navigates to /account/settings only when the response has no error', async () => {
    const { user, navigate, queryClient } = renderSignIn();
    queryClient.setQueryData(ME_QUERY_KEY, { name: 'Previous account' });
    signInEmail.mockResolvedValue({ data: { user: {} }, error: null });

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/account/settings' }));
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
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
  test('links to the forgot-password flow from sign-in', () => {
    renderSignIn();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('AuthScreen sign-up', () => {
  beforeEach(() => {
    signInEmail.mockReset();
    signUpEmail.mockReset();
  });

  test('renders native sign-up constraints and reciprocal navigation', () => {
    renderSignUp();
    expect(screen.getByLabelText('Name')).toBeRequired();
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '100');
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxlength', '254');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Password')).toBeRequired();
    expect(screen.getByLabelText('Password')).toHaveAttribute('minlength', '8');
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('type', 'date');
    expect(screen.queryByLabelText('Guardian email')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.getByLabelText('Confirm password')).toBeRequired();
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('minlength', '8');
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  test('rejects a password mismatch locally without calling the auth client', async () => {
    const { user } = renderSignUp();

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  test('maps a resolved sign-up 401 to non-enumerating copy', async () => {
    const { user } = renderSignUp();
    signUpEmail.mockResolvedValue({
      data: null,
      error: { status: 401, statusText: 'Unauthorized' },
    });

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password was not accepted.',
    );
  });

  test('maps a resolved sign-up 429 to retry-later copy', async () => {
    const { user } = renderSignUp();
    signUpEmail.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests' },
    });

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again later.',
    );
  });

  test('trims name and email, never the password, clears prior account data, and navigates', async () => {
    const navigate = vi.fn();
    const { user, queryClient } = renderSignUp(navigate);
    queryClient.setQueryData(ME_QUERY_KEY, { name: 'Previous account' });
    signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });

    await user.type(screen.getByLabelText('Name'), '  Player  ');
    await user.type(screen.getByLabelText('Email'), '  player@example.com  ');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Player',
          email: 'player@example.com',
          password: 'a-secure-password',
        }),
      );
      expect(navigate).toHaveBeenCalledWith({ to: '/account/settings' });
    });
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
  });

  test('reveals the guardian email field for a minor and sends both fields', async () => {
    const { user } = renderSignUp();
    signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });

    // No guardian field until a minor date of birth is entered.
    expect(screen.queryByLabelText('Guardian email')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '2015-06-01' },
    });
    expect(screen.getByLabelText('Guardian email')).toBeVisible();

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Guardian email'), 'parent@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Player',
          email: 'player@example.com',
          password: 'a-secure-password',
          dateOfBirth: '2015-06-01',
          guardianEmail: 'parent@example.com',
        }),
      );
    });
  });

  test('explains the guardian email for minors and rejects a guardian email matching the sign-up email', async () => {
    const { user } = renderSignUp();

    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '2015-06-01' },
    });
    expect(
      screen.getByText(
        "A guardian's email is required for players under 13, so a parent or guardian can confirm consent.",
      ),
    ).toBeVisible();

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Guardian email'), 'player@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The guardian email must be different from the sign-up email.',
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });
});
