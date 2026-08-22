import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { authClient } from '../auth-client.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { TextInput } from '../components/text-input.tsx';
import { AuthAmbient } from './auth-routes.tsx';

const RATE_LIMIT_COPY = 'Too many attempts. Try again later.';
const FAILURE_COPY = 'Something went wrong. Try again.';

export function ForgotPasswordRoute() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const data = new FormData(event.currentTarget);
    const rawEmail = data.get('email');
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
    setSubmitting(true);
    try {
      const { error } = await authClient.requestPasswordReset({ email });
      if (error === null) {
        setSent(true);
      } else {
        setErrorMessage(error.status === 429 ? RATE_LIMIT_COPY : FAILURE_COPY);
      }
    } catch {
      setErrorMessage(FAILURE_COPY);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AuthAmbient />
      <Card className="mx-auto w-full max-w-sm">
        <Heading level={1}>{sent ? 'Check your email' : 'Reset your password'}</Heading>
        {sent ? (
          <>
            <p className="mt-4 text-muted">
              If this email exists in our system, check your email for the reset link.
            </p>
            <p className="mt-4 text-center">
              <Link href="/sign-in">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-muted">
              Enter your email and we will send a link to reset your password.
            </p>
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
                <Field label="Email" inputID="email">
                  <TextInput
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </Field>
                <Button
                  type="submit"
                  label="Send reset link"
                  variant="primary"
                  isDisabled={submitting}
                  isLoading={submitting}
                  className="min-h-11 w-full press"
                />
              </FormLayout>
            </form>
            <p className="mt-4 text-center text-muted">
              <Link href="/sign-in">Back to sign in</Link>
            </p>
          </>
        )}
      </Card>
    </>
  );
}
