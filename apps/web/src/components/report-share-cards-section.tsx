import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reportShareApi, type CreateReportShareCardBody } from '../api/report-share-api.ts';
import { reportShareCardsQueryOptions } from '../query-client.ts';
import type { Stream } from '../api/diagnosis-api.ts';

const createdFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const inputClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/**
 * ST-127. The report's share-card surface: create a tokened card of the
 * report's biggest leak - the headline number and its label, frozen at
 * creation - list, copy, and revoke, exactly like the game share's links.
 * Opening the card needs no session and shows the two shared fields, the
 * mark, and nothing else.
 */
export function ReportShareCardsSection({
  stream,
  tournamentId,
}: {
  stream: Stream;
  /** The report's scope: a tournament-scoped card shares that tournament's headline. */
  tournamentId?: string | null;
}) {
  const queryClient = useQueryClient();
  const cardsQuery = useQuery(reportShareCardsQueryOptions());

  const [expiresOn, setExpiresOn] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const cards = cardsQuery.data ?? [];

  async function handleCreate() {
    setCreating(true);
    setFormError(null);
    const body: CreateReportShareCardBody = { stream };
    if (tournamentId) {
      body.tournamentId = tournamentId;
    }
    if (expiresOn !== '') {
      body.expiresAt = new Date(`${expiresOn}T23:59:59`).toISOString();
    }
    try {
      await reportShareApi.createReportShareCard(body);
      setExpiresOn('');
      await queryClient.invalidateQueries({ queryKey: ['report-share-cards'] });
    } catch {
      setFormError('The share card could not be created. Please try again.');
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
      await reportShareApi.revokeReportShareCard(id);
      setConfirmingId(null);
      await queryClient.invalidateQueries({ queryKey: ['report-share-cards'] });
    } catch {
      setRevokeError('The card could not be revoked. Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section aria-labelledby="report-share-heading" className="space-y-4">
      <Heading level={2} id="report-share-heading">
        Share cards
      </Heading>
      <Text as="p" display="block" type="supporting">
        Share your biggest leak as a card: the number and its label, and nothing else on the
        account. Opening it needs no account.
      </Text>

      <Card>
        <FormLayout>
          <Field label="Expires (optional)" inputID="reportShareExpires">
            <input
              id="reportShareExpires"
              name="reportShareExpires"
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
            label={creating ? 'Creating...' : 'Create share card'}
            variant="primary"
            onClick={() => {
              void handleCreate();
            }}
            isDisabled={creating}
            className="min-h-11 press"
          />
        </FormLayout>
      </Card>

      {cards.length === 0 ? (
        <Text as="p" display="block" type="supporting">
          No share cards yet.
        </Text>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <Card key={card.id}>
              <Text as="p" display="block" type="supporting">
                {`${card.ratingLeak} rating points - ${card.label}. Created on ${createdFormatter.format(new Date(card.createdAt))}.`}
                {card.expiresAt !== null
                  ? ` Expires ${createdFormatter.format(new Date(card.expiresAt))}.`
                  : ''}
              </Text>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Text className="min-w-0 flex-1 truncate font-mono text-sm text-primary">
                  {card.url}
                </Text>
                <Button
                  label={copiedId === card.id ? 'Copied' : 'Copy'}
                  variant="secondary"
                  onClick={() => {
                    void handleCopy(card.id, card.url);
                  }}
                  className="press"
                />
              </div>
              {confirmingId === card.id ? (
                <div className="mt-3 space-y-2">
                  <Text as="p" display="block" type="supporting">
                    Anyone holding this link will no longer be able to open this card.
                  </Text>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      label={revokingId === card.id ? 'Revoking...' : 'Confirm revoke'}
                      variant="destructive"
                      onClick={() => {
                        void handleRevoke(card.id);
                      }}
                      className="press"
                      isDisabled={revokingId === card.id}
                    />
                    <Button
                      label="Keep link"
                      variant="secondary"
                      onClick={() => setConfirmingId(null)}
                      className="press"
                      isDisabled={revokingId === card.id}
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
                  onClick={() => setConfirmingId(card.id)}
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
