import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { useNavigate } from '@tanstack/react-router';
import { authClient } from '../auth-client.ts';
import { StatusMessage } from '../components/status-message.tsx';

export type AuthMode = 'sign-in' | 'sign-up';
export type NavigateTo = (options: { to: string }) => void | Promise<void>;

export interface AuthScreenProps {
  mode: AuthMode;
  navigate: NavigateTo;
}

const REJECTION_COPY = 'Email or password was not accepted.';
const RATE_LIMIT_COPY = 'Too many attempts. Try again later.';
const MISMATCH_COPY = 'Passwords do not match.';

const inputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';

function readText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export function AuthScreen({ mode, navigate }: AuthScreenProps) {
  const isSignUp = mode === 'sign-up';
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const heading = isSignUp ? 'Create your account' : 'Sign in';
  const submitLabel = isSignUp ? 'Sign up' : 'Sign in';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const data = new FormData(event.currentTarget);
    const email = readText(data, 'email').trim();
    const password = readText(data, 'password');
    const name = readText(data, 'name').trim();

    if (isSignUp) {
      const confirmation = readText(data, 'passwordConfirmation');

      if (confirmation !== password) {
        setErrorMessage(MISMATCH_COPY);
        return;
      }
    }

    setSubmitting(true);
    try {
      const { error } = isSignUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
      if (error === null) {
        await navigate({ to: '/account' });
        return;
      }
      setErrorMessage(error.status === 429 ? RATE_LIMIT_COPY : REJECTION_COPY);
    } catch {
      setErrorMessage(REJECTION_COPY);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <Heading level={1}>{heading}</Heading>
      {errorMessage !== null ? (
        <div className="mt-4">
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FormLayout>
          {isSignUp ? (
            <Field label="Name" inputID="name">
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                maxLength={100}
                className={inputClassName}
              />
            </Field>
          ) : null}
          <Field label="Email" inputID="email">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              className={inputClassName}
            />
          </Field>
          <Field label="Password" inputID="password">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              minLength={8}
              className={inputClassName}
            />
          </Field>
          {isSignUp ? (
            <Field label="Confirm password" inputID="passwordConfirmation">
              <input
                id="passwordConfirmation"
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className={inputClassName}
              />
            </Field>
          ) : null}
          <Button
            type="submit"
            label={submitLabel}
            variant="primary"
            isDisabled={submitting}
            isLoading={submitting}
            className="min-h-11 w-full"
          />
        </FormLayout>
      </form>
    </Card>
  );
}

export function SignInRoute() {
  const navigate = useNavigate();
  return <AuthScreen mode="sign-in" navigate={navigate} />;
}

export function SignUpRoute() {
  const navigate = useNavigate();
  return <AuthScreen mode="sign-up" navigate={navigate} />;
}
