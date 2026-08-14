import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { Link, notFound, useNavigate, useParams } from '@tanstack/react-router';
import type { AccountApi, Me } from '../api/account-api.ts';
import { ApiRequestError, accountApi } from '../api/account-api.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import type { NavigateTo } from './auth-routes.tsx';

const inputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';

function readValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export interface GuardianScreenProps {
  me: Me;
  playerId: string | undefined;
  accountApi: AccountApi;
  queryClient: QueryClient;
  navigate: NavigateTo;
}

export function GuardianScreen({
  me,
  playerId,
  accountApi,
  queryClient,
  navigate,
}: GuardianScreenProps) {
  const found = me.players.find((owned) => owned.id === playerId);

  if (found === undefined) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
    throw notFound();
  }
  const player = found;

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const data = new FormData(event.currentTarget);
    const guardianEmail = readValue(data, 'guardianEmail');
    const relationship = readValue(data, 'relationship');

    setSubmitting(true);
    try {
      const body = relationship === '' ? { guardianEmail } : { guardianEmail, relationship };
      await accountApi.attachGuardian(player.id, body);
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          await navigate({ to: '/sign-in' });
          return;
        }
        if (error.status === 409) {
          setFormError('That guardian is already attached.');
          return;
        }
      }
      setFormError('The guardian could not be added. Please try again.');
      return;
    }

    setSuccessMessage('Guardian invitation sent.');
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    await navigate({ to: '/account' });
  }

  return (
    <Card>
      <Heading level={1}>Add guardian</Heading>
      <p className="mt-2 text-muted">
        You're adding a guardian for <strong>{player.displayName}</strong>.
      </p>
      <p className="mt-2 text-muted">The adult will receive an email to confirm their consent.</p>
      {formError !== null ? (
        <div className="mt-4">
          <StatusMessage tone="error">{formError}</StatusMessage>
        </div>
      ) : null}
      {successMessage !== null ? (
        <div className="mt-4">
          <StatusMessage tone="success">{successMessage}</StatusMessage>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FormLayout>
          <Field label="Guardian email" inputID="guardianEmail">
            <input
              id="guardianEmail"
              name="guardianEmail"
              type="email"
              autoComplete="email"
              required
              className={inputClassName}
            />
          </Field>
          <Field label="Relationship" inputID="relationship">
            <input
              id="relationship"
              name="relationship"
              type="text"
              maxLength={40}
              className={inputClassName}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              label="Send invitation"
              variant="primary"
              isDisabled={submitting}
              isLoading={submitting}
              className="min-h-11 flex-1"
            />
            <Link
              to="/account"
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-raised px-3 py-2 font-ui text-primary hover:bg-sunken focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus"
            >
              Cancel
            </Link>
          </div>
        </FormLayout>
      </form>
    </Card>
  );
}

export function GuardianRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params: { playerId?: string } = useParams({ strict: false });
  const { playerId } = params;
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <GuardianScreen
      me={me}
      playerId={playerId}
      accountApi={accountApi}
      queryClient={queryClient}
      navigate={navigate}
    />
  );
}
