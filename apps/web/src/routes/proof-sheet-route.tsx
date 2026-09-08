import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/account-api.ts';
import { proofSheetApi, type ProofSheet } from '../api/proof-sheet-api.ts';
import { proofSheetsQueryOptions } from '../query-client.ts';
import { UpgradePrompt } from '../components/upgrade-prompt.tsx';
import { StatusMessage } from '../components/status-message.tsx';

const createdFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function ProofSheetSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading share links"
      aria-busy="true"
      className="reveal-in space-y-4"
    >
      <div className="h-8 w-48 rounded-control bg-sunken" />
      <div className="h-4 w-72 rounded-control bg-sunken" />
      <div className="h-32 rounded-surface bg-sunken" />
    </div>
  );
}

export function ProofSheetScreen() {
  const queryClient = useQueryClient();
  const sheetsQuery = useQuery(proofSheetsQueryOptions());
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsFocus, setNeedsFocus] = useState(false);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setNeedsFocus(false);
    try {
      await proofSheetApi.createProofSheet();
      await queryClient.invalidateQueries({ queryKey: ['proof-sheets'] });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setNeedsFocus(true);
      } else {
        setError('The share link could not be created. Please try again.');
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(sheet: ProofSheet) {
    await navigator.clipboard.writeText(sheet.url);
    setCopiedId(sheet.id);
    window.setTimeout(() => setCopiedId((id) => (id === sheet.id ? null : id)), 2000);
  }

  async function handleRevoke(sheet: ProofSheet) {
    setRevokingId(sheet.id);
    setError(null);
    try {
      await proofSheetApi.revokeProofSheet(sheet.id);
      setConfirmingId(null);
      await queryClient.invalidateQueries({ queryKey: ['proof-sheets'] });
    } catch {
      setError('The link could not be revoked. Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  if (sheetsQuery.isPending) {
    return (
      <div className="space-y-6">
        <header className="reveal-in space-y-4">
          <Heading level={1}>Share a proof sheet</Heading>
        </header>
        <ProofSheetSkeleton />
      </div>
    );
  }

  if (
    sheetsQuery.isError &&
    sheetsQuery.error instanceof ApiRequestError &&
    sheetsQuery.error.code === 'upgrade_required'
  ) {
    return (
      <div className="space-y-6">
        <header className="reveal-in space-y-4">
          <Heading level={1}>Share a proof sheet</Heading>
        </header>
        <UpgradePrompt title="The proof sheet is part of the paid loop" />
      </div>
    );
  }

  if (sheetsQuery.isError) {
    return (
      <div className="space-y-6">
        <header className="reveal-in space-y-4">
          <Heading level={1}>Share a proof sheet</Heading>
        </header>
        <EmptyState
          className="reveal-in"
          title="Your share links could not be loaded"
          description="Try again in a moment."
          headingLevel={2}
        />
      </div>
    );
  }

  const sheets = sheetsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="reveal-in space-y-4">
        <Heading level={1}>Share a proof sheet</Heading>
        <Text as="p" display="block" type="supporting">
          Send a parent a before-and-after page for this focus.
        </Text>
      </header>

      {needsFocus ? (
        <Card className="reveal-in">
          <Heading level={2}>Set a focus first</Heading>
          <Text as="p" display="block" type="supporting" className="mt-2">
            A proof sheet shows whether a focus is working, so you need one active before you can
            create the link.
          </Text>
          <Button
            label="Set a focus"
            href="/focus?stream=tournament"
            variant="primary"
            className="mt-6"
          />
        </Card>
      ) : null}

      {error !== null ? <StatusMessage tone="error">{error}</StatusMessage> : null}

      <Card className="reveal-in">
        <Heading level={2}>Create a share link</Heading>
        <Text as="p" display="block" type="supporting" className="mt-2">
          The link opens the page a parent reads. It stays live until you revoke it.
        </Text>
        <Button
          label={creating ? 'Creating...' : 'Create a share link'}
          variant="primary"
          onClick={() => void handleCreate()}
          className="mt-3 min-h-11 press"
          isDisabled={creating}
        />
      </Card>

      {sheets.length === 0 ? (
        <Text as="p" display="block" type="supporting" className="reveal-in">
          No share links yet.
        </Text>
      ) : (
        <div className="reveal-in space-y-4">
          <Heading level={2}>Your share links</Heading>
          {sheets.map((sheet) => (
            <Card key={sheet.id}>
              <Text as="p" display="block" type="supporting">
                Created on {createdFormatter.format(new Date(sheet.createdAt))}.
              </Text>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Text className="min-w-0 flex-1 truncate font-mono text-sm text-primary">
                  {sheet.url}
                </Text>
                <Button
                  label={copiedId === sheet.id ? 'Copied' : 'Copy'}
                  variant="secondary"
                  onClick={() => void handleCopy(sheet)}
                  className="min-h-11 press"
                />
              </div>
              {confirmingId === sheet.id ? (
                <div className="mt-3 space-y-2">
                  <Text as="p" display="block" type="supporting">
                    Anyone holding this link will no longer be able to open the page.
                  </Text>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      label={revokingId === sheet.id ? 'Revoking...' : 'Confirm revoke'}
                      variant="destructive"
                      onClick={() => void handleRevoke(sheet)}
                      className="min-h-11 press"
                      isDisabled={revokingId === sheet.id}
                    />
                    <Button
                      label="Keep link"
                      variant="secondary"
                      onClick={() => setConfirmingId(null)}
                      className="min-h-11 press"
                      isDisabled={revokingId === sheet.id}
                    />
                  </div>
                </div>
              ) : (
                <Button
                  label="Revoke link"
                  variant="secondary"
                  onClick={() => setConfirmingId(sheet.id)}
                  className="mt-3 min-h-11 press"
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProofSheetRoute() {
  return <ProofSheetScreen />;
}
