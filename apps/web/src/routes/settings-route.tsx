import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { AccountApi, Me } from '../api/account-api.ts';
import { ApiRequestError, accountApi } from '../api/account-api.ts';
import { authClient } from '../auth-client.ts';
import { ChangePasswordForm } from '../components/change-password-form.tsx';
import { StatusMessage } from '../components/status-message.tsx';
import { TextInput } from '../components/text-input.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';

function readText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export interface SettingsScreenProps {
  me: Me;
  signOut: () => Promise<void>;
  accountApi: AccountApi;
  queryClient: QueryClient;
}

export function SettingsScreen({ me, signOut, accountApi, queryClient }: SettingsScreenProps) {
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [savingUsernames, setSavingUsernames] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('Sign out failed.');
    }
  }

  async function handleSaveUsernames(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUsernameError(null);
    setUsernameSaved(false);
    const data = new FormData(event.currentTarget);
    const chesscom = readText(data, 'chesscomUsername');
    const lichess = readText(data, 'lichessUsername');
    setSavingUsernames(true);
    try {
      await accountApi.updateMe({
        chesscomUsername: chesscom === '' ? undefined : chesscom,
        lichessUsername: lichess === '' ? undefined : lichess,
      });
      setUsernameSaved(true);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      } else {
        setUsernameError('The default usernames could not be saved.');
      }
    } finally {
      setSavingUsernames(false);
    }
  }

  return (
    <>
      <section aria-labelledby="account-heading" className="space-y-3">
        <Heading level={1} id="account-heading">
          Your account
        </Heading>
        <Text as="p" display="block" className="font-display text-lg leading-tight">
          {me.player.displayName}
        </Text>
      </section>

      <section aria-label="Your player" className="mt-8">
        <div className="flex flex-wrap gap-2">
          <Badge label={`${me.player.currentStreak}-day streak`} variant="orange" />
          <Badge label={`Level ${me.player.level}`} variant="info" />
        </div>
        <div className="mt-3">
          <Link href="/player">Edit player</Link>
        </div>
      </section>

      <section aria-labelledby="account-details-heading" className="mt-8">
        <Heading level={2} id="account-details-heading">
          Account details
        </Heading>
        <Text as="p" display="block" type="supporting">
          {me.email}
        </Text>
        <div>
          <Button label="See plans" href="/upgrade" variant="primary" className="mt-3" />
        </div>
      </section>

      <section aria-labelledby="default-usernames-heading" className="mt-8">
        <Heading level={2} id="default-usernames-heading">
          Default usernames
        </Heading>
        <Text as="p" display="block" type="supporting" className="mt-1">
          Used to prefill the import form so you do not retype them each time.
        </Text>
        {usernameError !== null ? (
          <div className="mt-3">
            <StatusMessage tone="error">{usernameError}</StatusMessage>
          </div>
        ) : null}
        {usernameSaved ? (
          <div className="mt-3">
            <StatusMessage tone="success">Default usernames saved.</StatusMessage>
          </div>
        ) : null}
        <form
          className="mt-3 max-w-sm"
          onSubmit={(event) => {
            void handleSaveUsernames(event);
          }}
        >
          <FormLayout>
            <Field label="Chess.com username" inputID="chesscomUsername">
              <TextInput
                id="chesscomUsername"
                name="chesscomUsername"
                type="text"
                autoComplete="username"
                maxLength={60}
                defaultValue={me.player.chesscomUsername ?? undefined}
              />
            </Field>
            <Field label="Lichess username" inputID="lichessUsername">
              <TextInput
                id="lichessUsername"
                name="lichessUsername"
                type="text"
                autoComplete="username"
                maxLength={60}
                defaultValue={me.player.lichessUsername ?? undefined}
              />
            </Field>
            <Button
              type="submit"
              label="Save default usernames"
              variant="secondary"
              isDisabled={savingUsernames}
              isLoading={savingUsernames}
              className="min-h-11 press"
            />
          </FormLayout>
        </form>
      </section>

      <section aria-labelledby="security-heading" className="mt-8">
        <Heading level={2} id="security-heading">
          Security
        </Heading>
        <div className="mt-3">
          <ChangePasswordForm />
        </div>
        <div className="mt-6">
          <Heading level={3} id="signout-heading">
            Sign out
          </Heading>
          {signOutError !== null ? (
            <div className="mt-3">
              <StatusMessage tone="error">{signOutError}</StatusMessage>
            </div>
          ) : null}
          <Button
            label="Sign out"
            variant="secondary"
            clickAction={handleSignOut}
            className="mt-3 press"
          />
        </div>
      </section>
    </>
  );
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions());

  const signOut = async () => {
    const { error } = await authClient.signOut();
    if (error !== null) throw new Error('Sign out failed.');
    // Navigate first, then clear: removing `/me` while this route is still
    // mounted suspends it and re-fetches with the session already cleared,
    // which surfaces a spurious 401.
    await navigate({ to: '/sign-in' });
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  };

  return (
    <SettingsScreen me={me} signOut={signOut} accountApi={accountApi} queryClient={queryClient} />
  );
}
