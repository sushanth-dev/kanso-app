import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { authClient } from '../auth-client.ts';
import { StatusMessage } from './status-message.tsx';
import { TextInput } from './text-input.tsx';

const MISMATCH_COPY = 'Passwords do not match.';
const REJECTION_COPY = 'Current password was not accepted.';
const RATE_LIMIT_COPY = 'Too many attempts. Try again later.';
const SUCCESS_COPY = 'Password changed.';

function readText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccess(false);
    const data = new FormData(event.currentTarget);
    const currentPassword = readText(data, 'currentPassword');
    const newPassword = readText(data, 'newPassword');
    const confirmation = readText(data, 'confirmation');
    if (newPassword !== confirmation) {
      setErrorMessage(MISMATCH_COPY);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await authClient.changePassword({ currentPassword, newPassword });
      if (error === null) {
        setSuccess(true);
        formRef.current?.reset();
      } else {
        setErrorMessage(error.status === 429 ? RATE_LIMIT_COPY : REJECTION_COPY);
      }
    } catch {
      setErrorMessage(REJECTION_COPY);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="password-heading" className="mt-8">
      <Heading level={2} id="password-heading">
        Change password
      </Heading>
      {success ? (
        <div className="mt-3">
          <StatusMessage tone="success">{SUCCESS_COPY}</StatusMessage>
        </div>
      ) : null}
      {errorMessage !== null ? (
        <div className="mt-3">
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
        </div>
      ) : null}
      <form
        ref={formRef}
        className="mt-3 max-w-sm"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FormLayout>
          <Field label="Current password" inputID="currentPassword">
            <TextInput
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
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
            label="Change password"
            variant="secondary"
            isDisabled={submitting}
            isLoading={submitting}
            className="min-h-11 press"
          />
        </FormLayout>
      </form>
    </section>
  );
}
