import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { AccountApi, Me } from '../api/account-api.ts';
import { ApiRequestError, accountApi } from '../api/account-api.ts';
import { authClient } from '../auth-client.ts';
import { ChangePasswordForm } from '../components/change-password-form.tsx';
import { PrimingLinkSection } from '../components/priming-link-section.tsx';
import { StatusMessage } from '../components/status-message.tsx';
import { TextInput } from '../components/text-input.tsx';
import { clearSessionState, ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';
import {
  resolveInitialContrast,
  setContrast as persistContrast,
  type ContrastPreference,
} from '../contrast.ts';
import {
  resolveInitialTheme,
  setTheme as persistTheme,
  type ThemePreference,
} from '../theme-preference.ts';

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
  // Seeded lazily so the stored choice or the OS hint decides the first paint.
  const [contrast, setContrast] = useState<ContrastPreference>(resolveInitialContrast);
  // Seeded like contrast: the stored choice or the OS hint decides the paint.
  const [theme, setThemeState] = useState<ThemePreference>(resolveInitialTheme);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('Sign out failed.');
    }
  }

  async function handleDeleteAccount() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await accountApi.deleteMe({ password: deletePassword });
      setDeleteOpen(false);
      try {
        await signOut();
      } catch {
        // The account is gone and the session cookie is dead even if the
        // sign-out call disagrees, so the redirect cannot be skipped.
        window.location.href = '/sign-in';
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        // The session died under us; the guard will send the player to
        // sign-in once /me is fetched again.
        setDeleteOpen(false);
        clearSessionState(queryClient);
      } else if (error instanceof ApiRequestError) {
        setDeleteError(error.message);
      } else {
        setDeleteError('The account could not be deleted.');
      }
    } finally {
      setDeleting(false);
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
        clearSessionState(queryClient);
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
          <Link hasUnderline href="/player" className="min-h-11 items-center">
            Edit player
          </Link>
        </div>
      </section>

      <Card aria-labelledby="account-details-heading" className="reveal-in mt-8">
        <Heading level={2} id="account-details-heading">
          Account details
        </Heading>
        <Text as="p" display="block" type="supporting">
          {me.email}
        </Text>
        <div>
          <Button
            label="See plans"
            href="/upgrade"
            variant="primary"
            className="mt-3 min-h-11 press"
          />
        </div>
      </Card>

      <Card aria-labelledby="appearance-heading" className="reveal-in mt-8">
        <Heading level={2} id="appearance-heading">
          Appearance
        </Heading>
        <Text as="p" display="block" type="supporting" className="mt-1">
          Nocturne is the study after dark, lit by one lamp. Study Room is the same study in
          daylight.
        </Text>
        <div className="mt-3 max-w-sm">
          <RadioList
            label="Theme"
            value={theme}
            onChange={(value) => {
              // The radio group reports strings; only the two theme values
              // are meaningful, so everything else is ignored.
              if (value !== 'nocturne' && value !== 'study-room') return;
              persistTheme(value);
              setThemeState(value);
            }}
          >
            <RadioListItem label="Nocturne" value="nocturne" className="min-h-11" />
            <RadioListItem label="Study Room" value="study-room" className="min-h-11" />
          </RadioList>
        </div>
        <Text as="p" display="block" type="supporting" className="mt-1">
          High contrast swaps the glass surfaces for solid white with black text, easier to read in
          bright light or with low vision.
        </Text>
        <div className="mt-3 max-w-sm">
          <RadioList
            label="Contrast"
            value={contrast}
            onChange={(value) => {
              // The radio group reports strings; only the two theme values
              // are meaningful, so everything else is ignored.
              if (value !== 'standard' && value !== 'high') return;
              persistContrast(value);
              setContrast(value);
            }}
          >
            <RadioListItem label="Standard" value="standard" className="min-h-11" />
            <RadioListItem label="High contrast" value="high" className="min-h-11" />
          </RadioList>
        </div>
      </Card>

      <Card aria-labelledby="default-usernames-heading" className="reveal-in mt-8">
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
            <StatusMessage tone="success" className="reveal-in">
              Default usernames saved.
            </StatusMessage>
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
      </Card>

      <PrimingLinkSection />

      <Card aria-labelledby="security-heading" className="reveal-in mt-8">
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
            className="mt-3 min-h-11 press"
          />
        </div>
      </Card>

      <Card aria-labelledby="danger-heading" className="reveal-in mt-8">
        <Heading level={2} id="danger-heading">
          Danger zone
        </Heading>
        <Text as="p" display="block" type="supporting" className="mt-1">
          Deleting the account erases your games, reports, and practice history for good. There is
          no way back.
        </Text>
        {deleteOpen ? (
          <form
            className="mt-3 max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void handleDeleteAccount();
            }}
          >
            {deleteError !== null ? (
              <div className="mb-3">
                <StatusMessage tone="error">{deleteError}</StatusMessage>
              </div>
            ) : null}
            <FormLayout>
              <Field label="Confirm with your password" inputID="deletePassword">
                <TextInput
                  id="deletePassword"
                  name="deletePassword"
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.currentTarget.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  label="Delete forever"
                  variant="destructive"
                  isDisabled={deleting || deletePassword === ''}
                  isLoading={deleting}
                  className="min-h-11 press"
                />
                <Button
                  label="Keep my account"
                  variant="secondary"
                  clickAction={() => {
                    setDeleteOpen(false);
                  }}
                  className="min-h-11 press"
                />
              </div>
            </FormLayout>
          </form>
        ) : (
          <Button
            label="Delete account"
            variant="destructive"
            clickAction={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
            className="mt-3 min-h-11 press"
          />
        )}
      </Card>
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
    clearSessionState(queryClient);
  };

  return (
    <SettingsScreen me={me} signOut={signOut} accountApi={accountApi} queryClient={queryClient} />
  );
}
