import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gameShareApi, type CreateGameShareLinkBody } from '../api/game-share-api.ts';
import { gameShareLinksQueryOptions } from '../query-client.ts';

const createdFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const inputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/**
 * ST-118. The game share surface on the review page: create a read-only link
 * to this one reviewed game, list, copy, and revoke, exactly like the proof
 * sheet's shares. The created link is sent by the player themselves; opening
 * it needs no session and shows the game and nothing else.
 */
export function GameShareLinksSection({ gameId }: { gameId: string }) {
  const queryClient = useQueryClient();
  const linksQuery = useQuery(gameShareLinksQueryOptions(gameId));

  const [expiresOn, setExpiresOn] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const links = linksQuery.data ?? [];

  async function handleCreate() {
    setCreating(true);
    setFormError(null);
    const body: CreateGameShareLinkBody = {};
    if (expiresOn !== '') {
      body.expiresAt = new Date(`${expiresOn}T23:59:59`).toISOString();
    }
    try {
      await gameShareApi.createGameShareLink(gameId, body);
      setExpiresOn('');
      await queryClient.invalidateQueries({ queryKey: ['game-share-links', gameId] });
    } catch {
      setFormError('The share link could not be created. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(id: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((copied) => (copied === id ? null : copied)), 2000);
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setRevokeError(null);
    try {
      await gameShareApi.revokeGameShareLink(gameId, id);
      setConfirmingId(null);
      await queryClient.invalidateQueries({ queryKey: ['game-share-links', gameId] });
    } catch {
      setRevokeError('The link could not be revoked. Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section aria-labelledby="game-share-heading" className="reveal-in space-y-4">
      <Heading level={2} id="game-share-heading">
        Share links
      </Heading>
      <Text as="p" display="block" type="supporting">
        Share this reviewed game as a read-only link. Opening it shows the board, the moves and the
        mistakes; nothing else on the account.
      </Text>

      <Card>
        <FormLayout>
          <Field label="Expires (optional)" inputID="gameShareExpires">
            <input
              id="gameShareExpires"
              name="gameShareExpires"
              type="date"
              value={expiresOn}
              onChange={(event) => {
                setExpiresOn(event.target.value);
              }}
              className={inputClassName}
            />
          </Field>
          {formError !== null ? (
            <Text as="p" display="block" type="supporting" role="alert">
              {formError}
            </Text>
          ) : null}
          <Button
            label={creating ? 'Creating...' : 'Create share link'}
            variant="primary"
            onClick={() => {
              void handleCreate();
            }}
            isDisabled={creating}
            className="min-h-11 press"
          />
        </FormLayout>
      </Card>

      {links.length === 0 ? (
        <Text as="p" display="block" type="supporting">
          No share links yet.
        </Text>
      ) : (
        <div className="space-y-4">
          {links.map((link) => (
            <Card key={link.id}>
              <Text as="p" display="block" type="supporting">
                Created on {createdFormatter.format(new Date(link.createdAt))}.
                {link.expiresAt !== null
                  ? ` Expires ${createdFormatter.format(new Date(link.expiresAt))}.`
                  : ''}
              </Text>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Text className="min-w-0 flex-1 truncate font-mono text-sm text-primary">
                  {link.url}
                </Text>
                <Button
                  label={copiedId === link.id ? 'Copied' : 'Copy'}
                  variant="secondary"
                  onClick={() => {
                    void handleCopy(link.id, link.url);
                  }}
                  className="press"
                />
              </div>
              {confirmingId === link.id ? (
                <div className="mt-3 space-y-2">
                  <Text as="p" display="block" type="supporting">
                    Anyone holding this link will no longer be able to open this game.
                  </Text>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      label={revokingId === link.id ? 'Revoking...' : 'Confirm revoke'}
                      variant="destructive"
                      onClick={() => {
                        void handleRevoke(link.id);
                      }}
                      className="press"
                      isDisabled={revokingId === link.id}
                    />
                    <Button
                      label="Keep link"
                      variant="secondary"
                      onClick={() => setConfirmingId(null)}
                      className="press"
                      isDisabled={revokingId === link.id}
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
                  label="Revoke link"
                  variant="secondary"
                  onClick={() => setConfirmingId(link.id)}
                  className="mt-3 press"
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
