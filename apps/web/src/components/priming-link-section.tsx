import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { primingApi } from '../api/priming-api.ts';
import { primingTokenQueryOptions } from '../query-client.ts';

const createdFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * ST-153. The priming token's only surface: create it, see the secret once,
 * copy it into the extension, and revoke it. The list names a prefix only,
 * because the stored column is the hash - the secret is never shown again,
 * and creating a new one retires the old.
 */
export function PrimingLinkSection() {
  const queryClient = useQueryClient();
  const tokenQuery = useQuery(primingTokenQueryOptions());

  const [secret, setSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const live = tokenQuery.data?.[0] ?? null;

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await primingApi.createPrimingToken();
      setSecret(created.token);
      await queryClient.invalidateQueries({ queryKey: ['priming-tokens'] });
    } catch {
      setCreateError('The priming token could not be created. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (secret === null) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevoke() {
    if (live === null) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await primingApi.revokePrimingToken(live.id);
      setConfirming(false);
      setSecret(null);
      await queryClient.invalidateQueries({ queryKey: ['priming-tokens'] });
    } catch {
      setRevokeError('The token could not be revoked. Please try again.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card aria-labelledby="priming-heading" className="reveal-in mt-8">
      <Heading level={2} id="priming-heading">
        Pre-game primer
      </Heading>
      <Text as="p" display="block" type="supporting" className="mt-1">
        The browser extension shows your active mistake patterns seconds before a game on Lichess or
        Chess.com. It reads a brief with this token, so keep it to yourself.
      </Text>

      {createError !== null ? (
        <div className="mt-3">
          <Text as="p" display="block" type="supporting" role="alert" className="reveal-in">
            {createError}
          </Text>
        </div>
      ) : null}

      {secret !== null ? (
        <div className="mt-3 space-y-2">
          <Text as="p" display="block" type="supporting">
            Copy it now. This is the only time the full token is shown.
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <Text className="min-w-0 flex-1 truncate font-mono text-sm text-primary">{secret}</Text>
            <Button
              label={copied ? 'Copied' : 'Copy token'}
              variant="secondary"
              onClick={() => {
                void handleCopy();
              }}
              className="press"
            />
          </div>
        </div>
      ) : null}

      {live === null ? (
        <div className="mt-3 space-y-2">
          {tokenQuery.isSuccess && tokenQuery.data.length === 0 ? (
            <Text as="p" display="block" type="supporting">
              No token yet.
            </Text>
          ) : null}
          <Button
            label={creating ? 'Creating...' : 'Create priming token'}
            variant="primary"
            onClick={() => {
              void handleCreate();
            }}
            isDisabled={creating}
            className="min-h-11 press"
          />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Text as="p" display="block" type="supporting">
            {`Live token ${live.tokenPrefix}... created on ${createdFormatter.format(new Date(live.createdAt))}.`}
          </Text>
          {confirming ? (
            <div className="reveal-in space-y-2">
              <Text as="p" display="block" type="supporting">
                The extension will stop receiving briefs until you create a new token.
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button
                  label={revoking ? 'Revoking...' : 'Confirm revoke'}
                  variant="destructive"
                  onClick={() => {
                    void handleRevoke();
                  }}
                  className="press"
                  isDisabled={revoking}
                />
                <Button
                  label="Keep token"
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                  className="press"
                  isDisabled={revoking}
                />
              </div>
              {revokeError !== null ? (
                <Text as="p" display="block" type="supporting" role="alert">
                  {revokeError}
                </Text>
              ) : null}
            </div>
          ) : (
            <Button
              label="Revoke token"
              variant="secondary"
              onClick={() => setConfirming(true)}
              className="press"
            />
          )}
        </div>
      )}
    </Card>
  );
}
