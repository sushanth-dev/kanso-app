import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Link, useParams } from '@tanstack/react-router';
import { authClient } from '../auth-client.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { TextInput } from '../components/text-input.tsx';
import { AuthAmbient } from './auth-routes.tsx';

const MISMATCH_COPY = 'Passwords do not match.';
const RATE_LIMIT_COPY = 'Too many attempts. Try again later.';
const FAILURE_COPY = 'Something went wrong. Try again.';
const LINK_CLASS =
  'inline-flex min-h-11 items-center font-ui text-accent underline press hover:text-accent-hover';

function readText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export function ResetPasswordRoute() {
  const { token } = useParams({ from: '/reset-password/$token' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const data = new FormData(event.currentTarget);
    const newPassword = readText(data, 'newPassword');
    const confirmation = readText(data, 'confirmation');
    if (newPassword !== confirmation) {
      setErrorMessage(MISMATCH_COPY);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword, token });
      if (error === null) {
        setDone(true);
      } else if (error.code === 'INVALID_TOKEN') {
        setInvalid(true);
      } else {
        setErrorMessage(error.status === 429 ? RATE_LIMIT_COPY : FAILURE_COPY);
      }
    } catch {
      setErrorMessage(FAILURE_COPY);
    } finally {
      setSubmitting(false);
    }
  }

  if (invalid) {
    return (
      <>
        <AuthAmbient />
        <Card className="mx-auto w-full max-w-sm">
          <Heading level={1}>This link is no longer available.</Heading>
          <p className="mt-4 text-muted">
            The link was used already, expired, or does not match a reset request.
          </p>
          <p className="mt-4">
            <Link to="/forgot-password" className={LINK_CLASS}>
              Request a new link
            </Link>
          </p>
        </Card>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthAmbient />
        <Card className="mx-auto w-full max-w-sm">
          <Heading level={1}>Password reset</Heading>
          <p className="mt-4 text-muted">Your password was reset. Sign in with it now.</p>
          <p className="mt-4">
            <Link to="/sign-in" className={LINK_CLASS}>
              Sign in
            </Link>
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <AuthAmbient />
      <Card className="mx-auto w-full max-w-sm">
        <Heading level={1}>Set a new password</Heading>
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
            <Field label="New password" inputID="newPassword">
              <TextInput
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </Field>
            <Field label="Confirm new password" inputID="confirmation">
              <TextInput
                id="confirmation"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </Field>
            <Button
              type="submit"
              label="Set password"
              variant="primary"
              isDisabled={submitting}
              isLoading={submitting}
              className="min-h-11 w-full press"
            />
          </FormLayout>
        </form>
      </Card>
    </>
  );
}
