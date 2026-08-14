import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field, type FieldStatusInput } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { Link, notFound, useNavigate, useParams } from '@tanstack/react-router';
import type { AccountApi, CreatePlayer, Me } from '../api/account-api.ts';
import { ApiRequestError, accountApi } from '../api/account-api.ts';
import { StatusMessage, useStatusMessage } from '../components/status-message.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import type { NavigateTo } from './auth-routes.tsx';

const textFields = ['fideId', 'uscfId', 'chesscomUsername', 'lichessUsername'] as const;
const numberFields = ['birthYear', 'fideRating', 'uscfRating'] as const;

const numberFieldLabels: Record<(typeof numberFields)[number], string> = {
  birthYear: 'Birth year',
  fideRating: 'FIDE rating',
  uscfRating: 'USCF rating',
};

const inputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus';

function readValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function playerBody(formData: FormData): CreatePlayer {
  const displayName = readValue(formData, 'displayName');
  if (displayName === '') {
    throw new Error('Display name is required.');
  }
  const body: CreatePlayer = { displayName };
  for (const field of textFields) {
    const value = readValue(formData, field);
    if (value !== '') body[field] = value;
  }
  for (const field of numberFields) {
    const raw = readValue(formData, field);
    if (raw === '') continue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${numberFieldLabels[field]} must be a number.`);
    }
    body[field] = parsed;
  }
  return body;
}

function issuesByPath(issues: { path: string; message: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    map[issue.path] = issue.message;
  }
  return map;
}

function fieldStatus(message: string | undefined): FieldStatusInput | undefined {
  return message === undefined ? undefined : { type: 'error', message };
}

function numberDefault(value: number | null): string {
  return value === null ? '' : String(value);
}

export interface PlayerFormScreenProps {
  mode: 'create' | 'edit';
  me: Me;
  playerId?: string;
  accountApi: AccountApi;
  queryClient: QueryClient;
  navigate: NavigateTo;
}

export function PlayerFormScreen({
  mode,
  me,
  playerId,
  accountApi,
  queryClient,
  navigate,
}: PlayerFormScreenProps) {
  const isEdit = mode === 'edit';
  const player = isEdit ? me.players.find((owned) => owned.id === playerId) : undefined;

  if (isEdit && player === undefined) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() returns a router not-found error, not an Error.
    throw notFound();
  }

  const { setMessage } = useStatusMessage();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setMessage(null);
  }, [setMessage]);

  const heading = isEdit ? 'Edit player' : 'New player';
  const submitLabel = isEdit ? 'Save changes' : 'Create player';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setMessage(null);
    setFieldErrors({});

    let body: CreatePlayer;
    try {
      body = playerBody(new FormData(event.currentTarget));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Please check the form.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && player !== undefined) {
        await accountApi.updatePlayer(player.id, body);
      } else {
        await accountApi.createPlayer(body);
      }
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          await navigate({ to: '/sign-in' });
          return;
        }
        if (error.status === 403) {
          setFormError('This player cannot be changed from this account.');
          return;
        }
        if (error.status === 400) {
          const issues = error.issues ?? [];
          if (issues.length > 0) {
            setFieldErrors(issuesByPath(issues));
            return;
          }
        }
      }
      setFormError('The player could not be saved. Please try again.');
      return;
    }
    setMessage('Player saved.');
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    await navigate({ to: '/account' });
  }

  return (
    <Card>
      <Heading level={1}>{heading}</Heading>
      {formError !== null ? (
        <div className="mt-4">
          <StatusMessage tone="error">{formError}</StatusMessage>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FormLayout>
          <Field
            label="Display name"
            inputID="displayName"
            status={fieldStatus(fieldErrors.displayName)}
          >
            <input
              id="displayName"
              name="displayName"
              type="text"
              required
              maxLength={80}
              defaultValue={player?.displayName}
              aria-invalid={fieldErrors.displayName === undefined ? undefined : true}
              aria-describedby={
                fieldErrors.displayName === undefined ? undefined : 'displayName-status'
              }
              className={inputClassName}
            />
          </Field>
          <Field label="Birth year" inputID="birthYear" status={fieldStatus(fieldErrors.birthYear)}>
            <input
              id="birthYear"
              name="birthYear"
              type="number"
              min={1900}
              max={2100}
              defaultValue={player === undefined ? undefined : numberDefault(player.birthYear)}
              aria-invalid={fieldErrors.birthYear === undefined ? undefined : true}
              aria-describedby={
                fieldErrors.birthYear === undefined ? undefined : 'birthYear-status'
              }
              className={inputClassName}
            />
          </Field>
          <Field label="FIDE ID" inputID="fideId" status={fieldStatus(fieldErrors.fideId)}>
            <input
              id="fideId"
              name="fideId"
              type="text"
              maxLength={20}
              defaultValue={player?.fideId ?? undefined}
              aria-invalid={fieldErrors.fideId === undefined ? undefined : true}
              aria-describedby={fieldErrors.fideId === undefined ? undefined : 'fideId-status'}
              className={inputClassName}
            />
          </Field>
          <Field
            label="FIDE rating"
            inputID="fideRating"
            status={fieldStatus(fieldErrors.fideRating)}
          >
            <input
              id="fideRating"
              name="fideRating"
              type="number"
              min={0}
              max={3500}
              defaultValue={player === undefined ? undefined : numberDefault(player.fideRating)}
              aria-invalid={fieldErrors.fideRating === undefined ? undefined : true}
              aria-describedby={
                fieldErrors.fideRating === undefined ? undefined : 'fideRating-status'
              }
              className={inputClassName}
            />
          </Field>
          <Field label="USCF ID" inputID="uscfId" status={fieldStatus(fieldErrors.uscfId)}>
            <input
              id="uscfId"
              name="uscfId"
              type="text"
              maxLength={20}
              defaultValue={player?.uscfId ?? undefined}
              aria-invalid={fieldErrors.uscfId === undefined ? undefined : true}
              aria-describedby={fieldErrors.uscfId === undefined ? undefined : 'uscfId-status'}
              className={inputClassName}
            />
          </Field>
          <Field
            label="USCF rating"
            inputID="uscfRating"
            status={fieldStatus(fieldErrors.uscfRating)}
          >
            <input
              id="uscfRating"
              name="uscfRating"
              type="number"
              min={0}
              max={3500}
              defaultValue={player === undefined ? undefined : numberDefault(player.uscfRating)}
              aria-invalid={fieldErrors.uscfRating === undefined ? undefined : true}
              aria-describedby={
                fieldErrors.uscfRating === undefined ? undefined : 'uscfRating-status'
              }
              className={inputClassName}
            />
          </Field>
          <Field
            label="Chess.com username"
            inputID="chesscomUsername"
            status={fieldStatus(fieldErrors.chesscomUsername)}
          >
            <input
              id="chesscomUsername"
              name="chesscomUsername"
              type="text"
              maxLength={60}
              defaultValue={player?.chesscomUsername ?? undefined}
              aria-invalid={fieldErrors.chesscomUsername === undefined ? undefined : true}
              aria-describedby={
                fieldErrors.chesscomUsername === undefined ? undefined : 'chesscomUsername-status'
              }
              className={inputClassName}
            />
          </Field>
          <Field
            label="Lichess username"
            inputID="lichessUsername"
            status={fieldStatus(fieldErrors.lichessUsername)}
          >
            <input
              id="lichessUsername"
              name="lichessUsername"
              type="text"
              maxLength={60}
              defaultValue={player?.lichessUsername ?? undefined}
              aria-invalid={fieldErrors.lichessUsername === undefined ? undefined : true}
              aria-describedby={
                fieldErrors.lichessUsername === undefined ? undefined : 'lichessUsername-status'
              }
              className={inputClassName}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              label={submitLabel}
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

export function PlayerNewRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <PlayerFormScreen
      mode="create"
      me={me}
      accountApi={accountApi}
      queryClient={queryClient}
      navigate={navigate}
    />
  );
}

export function PlayerEditRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params: { playerId?: string } = useParams({ strict: false });
  const { playerId } = params;
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <PlayerFormScreen
      mode="edit"
      me={me}
      playerId={playerId}
      accountApi={accountApi}
      queryClient={queryClient}
      navigate={navigate}
    />
  );
}
