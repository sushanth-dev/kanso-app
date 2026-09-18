import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
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

const ACKNOWLEDGEMENT_LABEL = 'I accept the privacy notice and the terms';
const ACKNOWLEDGEMENT_COPY = 'Accept the privacy notice and the terms to create your account.';

/** A valid sign-up carries the acknowledgement, so every fill of the form sets it. */
async function acceptNotice(user: UserEvent) {
  await user.click(screen.getByRole('checkbox', { name: ACKNOWLEDGEMENT_LABEL }));
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

  test('navigates to /report only when the response has no error', async () => {
    const { user, navigate, queryClient } = renderSignIn();
    queryClient.setQueryData(ME_QUERY_KEY, { name: 'Previous account' });
    signInEmail.mockResolvedValue({ data: { user: {} }, error: null });

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/report' }));
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
  test('maps a thrown sign-in failure to the same non-enumerating copy', async () => {
    signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    const { user } = renderSignIn();

    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password was not accepted.',
    );
  });

  test('carries no privacy notice or acknowledgement away from sign-up', () => {
    renderSignIn();
    expect(screen.queryByText(/We collect your name/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Privacy and terms' })).not.toBeInTheDocument();
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
    await acceptNotice(user);
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
    await acceptNotice(user);
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
    await acceptNotice(user);
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
    await acceptNotice(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Player',
          email: 'player@example.com',
          password: 'a-secure-password',
        }),
      );
      expect(navigate).toHaveBeenCalledWith({ to: '/report' });
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
    await acceptNotice(user);
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
    await acceptNotice(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The guardian email must be different from the sign-up email.',
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });
  test('hides the guardian email for an adult date of birth and omits it from the payload', async () => {
    const { user } = renderSignUp();
    signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });

    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '2010-01-01' },
    });
    expect(screen.queryByLabelText('Guardian email')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await acceptNotice(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ dateOfBirth: '2010-01-01', guardianEmail: undefined }),
      );
    });
  });

  test('sends no date of birth when the field is left empty', async () => {
    const { user } = renderSignUp();
    signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await acceptNotice(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ dateOfBirth: undefined, guardianEmail: undefined }),
      );
    });
  });

  test('rejects a guardian email matching the sign-up email case-insensitively', async () => {
    const { user } = renderSignUp();

    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '2015-06-01' },
    });
    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'PLAYER@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Guardian email'), 'player@example.com');
    await acceptNotice(user);
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The guardian email must be different from the sign-up email.',
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  test('states what is collected, why, and links both policy documents above the button', () => {
    renderSignUp();

    expect(screen.getByText(/We collect your name, your email address/)).toBeVisible();
    expect(screen.getByText(/labels the player on their report/)).toBeVisible();
    expect(screen.getByText(/guardian email is needed/)).toBeVisible();

    // Scoped to the notice: the footer carries its own links to the same two
    // documents, which is the placement the notice exists to spare the reader.
    const noticeLinks = within(screen.getByRole('navigation', { name: 'Privacy and terms' }));
    expect(noticeLinks.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(noticeLinks.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });

  test('states the under-13 rule before the guardian field is revealed', () => {
    renderSignUp();

    // The rule is part of the standing notice, so it is readable before any
    // date is typed, while the field it describes is still absent.
    expect(screen.getByText(/stays closed to use until a guardian confirms/)).toBeVisible();
    expect(screen.queryByLabelText('Guardian email')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Date of birth'), {
      target: { value: '2015-06-01' },
    });
    expect(screen.getByLabelText('Guardian email')).toBeVisible();
  });

  test('arrives unticked and refuses to create the account until it is accepted', async () => {
    const { user } = renderSignUp();
    const acknowledgement = screen.getByRole('checkbox', { name: ACKNOWLEDGEMENT_LABEL });
    expect(acknowledgement).not.toBeChecked();

    await user.type(screen.getByLabelText('Name'), 'Player');
    await user.type(screen.getByLabelText('Email'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByText(ACKNOWLEDGEMENT_COPY)).toBeVisible();
    expect(signUpEmail).not.toHaveBeenCalled();

    // The message is the control's own description, not a banner elsewhere on
    // the card, so the reader meets the refusal where the control is.
    const messageId = acknowledgement.getAttribute('aria-describedby');
    expect(document.getElementById(messageId ?? '')).toHaveTextContent(ACKNOWLEDGEMENT_COPY);
    expect(acknowledgement).toHaveAttribute('aria-invalid', 'true');

    signUpEmail.mockResolvedValue({ data: { user: {} }, error: null });
    await acceptNotice(user);
    expect(acknowledgement).not.toHaveAttribute('aria-describedby');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'player@example.com' }),
      );
    });
    // The screen sends a claim, and it sends it as an instant rather than as
    // preformatted text. What the claim is worth, which is nothing, is asserted
    // where it can be: the server discards this value and writes its own clock,
    // and `auth.integration.test.ts` proves that end to end.
    const sent = signUpEmail.mock.calls.at(-1)?.[0];
    expect(sent?.privacyAcknowledgedAt).toBeInstanceOf(Date);
  });
});
