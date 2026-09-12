import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/account-api.ts';
import { assignmentApi, type CreateAssignmentLinkBody } from '../api/assignment-api.ts';
import type { FocusCatalogueEntry } from '../api/focus-api.ts';
import { assignmentsQueryOptions } from '../query-client.ts';

const createdFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const selectClassName =
  'min-h-11 w-full rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

const textareaClassName =
  'min-h-24 w-full resize-y rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/**
 * ST-117. The assignment link surface on the focus page: create from a
 * catalogue focus and the coach's dictated words, list, copy, and revoke,
 * exactly like the proof sheet's shares. The created link is sent by the
 * player or coach themselves; opening it needs no session, accepting it does.
 */
export function AssignmentLinksSection({
  catalogue,
  activeCatalogueKey,
}: {
  catalogue: FocusCatalogueEntry[];
  activeCatalogueKey: string | null;
}) {
  const queryClient = useQueryClient();
  const linksQuery = useQuery(assignmentsQueryOptions());

  const [catalogueKey, setCatalogueKey] = useState(activeCatalogueKey ?? '');
  const [instruction, setInstruction] = useState('');
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
    const body: CreateAssignmentLinkBody = { catalogueKey, instruction: instruction.trim() };
    if (expiresOn !== '') {
      body.expiresAt = new Date(`${expiresOn}T23:59:59`).toISOString();
    }
    try {
      await assignmentApi.createAssignmentLink(body);
      setInstruction('');
      setExpiresOn('');
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setFormError('That focus is no longer available. Choose another.');
      } else {
        setFormError('The assignment link could not be created. Please try again.');
      }
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
      await assignmentApi.revokeAssignmentLink(id);
      setConfirmingId(null);
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
    } catch {
      setRevokeError('The link could not be revoked. Please try again.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section aria-labelledby="assignment-links-heading" className="reveal-in space-y-4">
      <Heading level={2} id="assignment-links-heading">
        Assignment links
      </Heading>
      <Text as="p" display="block" type="supporting">
        Record the coach's assignment as a link. Opening it shows the focus and the instruction;
        accepting it sets the active focus.
      </Text>

      <Card>
        <FormLayout>
          <Field label="The focus the coach assigned" inputID="assignmentFocus">
            <select
              id="assignmentFocus"
              name="assignmentFocus"
              value={catalogueKey}
              onChange={(event) => {
                setCatalogueKey(event.target.value);
              }}
              className={selectClassName}
            >
              <option value="">Choose a focus</option>
              {catalogue.map((entry) => (
                <option key={entry.id} value={entry.key}>
                  {entry.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="The coach's instruction" inputID="assignmentInstruction">
            <textarea
              id="assignmentInstruction"
              name="assignmentInstruction"
              rows={3}
              maxLength={500}
              value={instruction}
              placeholder="In the coach's own words"
              onChange={(event) => {
                setInstruction(event.target.value);
              }}
              className={textareaClassName}
            />
          </Field>
          <Field label="Expires (optional)" inputID="assignmentExpires">
            <input
              id="assignmentExpires"
              name="assignmentExpires"
              type="date"
              value={expiresOn}
              onChange={(event) => {
                setExpiresOn(event.target.value);
              }}
              className={selectClassName}
            />
          </Field>
          {formError !== null ? (
            <Text as="p" display="block" type="supporting" role="alert" className="reveal-in">
              {formError}
            </Text>
          ) : null}
          <Button
            label={creating ? 'Creating...' : 'Create an assignment link'}
            variant="primary"
            onClick={() => {
              if (catalogueKey === '' || instruction.trim().length === 0) {
                setFormError(
                  catalogueKey === ''
                    ? 'Choose the focus the coach assigned.'
                    : 'Write the instruction in the coach\u2019s own words.',
                );
                return;
              }
              void handleCreate();
            }}
            isDisabled={creating}
            className="min-h-11 press"
          />
        </FormLayout>
      </Card>

      {links.length === 0 ? (
        <Text as="p" display="block" type="supporting">
          No assignment links yet.
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
                <div className="reveal-in mt-3 space-y-2">
                  <Text as="p" display="block" type="supporting">
                    Anyone holding this link will no longer be able to open the assignment.
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
