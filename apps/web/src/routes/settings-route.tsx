import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type Me, type Tier } from '../api/account-api.ts';
import { authClient } from '../auth-client.ts';
import { ChangePasswordForm } from '../components/change-password-form.tsx';
import { primaryLinkClassName } from '../components/primary-link.ts';
import { secondaryLinkClassName } from '../components/secondary-link.ts';
import { StatusMessage } from '../components/status-message.tsx';
import { ME_QUERY_KEY, meQueryOptions } from '../query-client.ts';

const TIER_LABEL: Record<Tier, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  pro: 'Pro',
};

export interface SettingsScreenProps {
  me: Me;
  signOut: () => Promise<void>;
}

export function SettingsScreen({ me, signOut }: SettingsScreenProps) {
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('Sign out failed.');
    }
  }

  return (
    <>
      <header className="space-y-4">
        <Link to="/account" className={secondaryLinkClassName}>
          Back to your account
        </Link>
        <Heading level={1}>Settings</Heading>
      </header>

      <section aria-labelledby="account-details-heading" className="mt-8">
        <Heading level={2} id="account-details-heading">
          Account details
        </Heading>
        <p className="text-muted">{me.email}</p>
        <Badge label={TIER_LABEL[me.tier]} variant="neutral" />
        <div>
          <Link to="/account/upgrade" className={`${primaryLinkClassName} mt-3`}>
            See plans
          </Link>
        </div>
      </section>

      <section aria-labelledby="signout-heading" className="mt-8">
        <Heading level={2} id="signout-heading">
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
      </section>

      <ChangePasswordForm />
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

  return <SettingsScreen me={me} signOut={signOut} />;
}
