import { useState, type FormEvent } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Field } from '@astryxdesign/core/Field';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiRequestError } from '../api/account-api.ts';
import { diagnosisApi, type ActionItemList } from '../api/diagnosis-api.ts';
import { actionItemsQueryOptions, ME_QUERY_KEY } from '../query-client.ts';

type ActionItemRow = ActionItemList['items'][number];

const TIER_LABEL: Record<ActionItemRow['tier'], string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** The tier tag the model prefixed is data for the badge, noise for the link. */
function stripTierTag(resource: string): string {
  return resource.replace(/^\[\w+\]\s*/, '');
}

const completedFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const summaryClassName =
  'min-h-28 w-full resize-y rounded-control border border-border-strong bg-raised px-3 py-2 text-primary transition-control focus:border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/**
 * ST-107. One pending item's assessment: the player writes the concept's core
 * idea in their own words, the coach judges it, and a pass refetches the list
 * so the card flips to its passed state. A fail keeps the form open with the
 * coach's feedback; a refused or failed call stores nothing.
 */
function AssessmentForm({ item }: { item: ActionItemRow }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (summary.trim() === '') {
      setError('Write a short summary of the core idea first.');
      return;
    }
    setError(undefined);
    setFeedback(null);
    setSubmitting(true);
    void diagnosisApi
      .markActionItemDone({ actionItemId: item.id, summary: summary.trim() })
      .then(async (result) => {
        if (result.pass) {
          // The refetched list carries the item's done state; the account
          // page carries the award, the report carries the curriculum.
          await queryClient.invalidateQueries({ queryKey: ['action-items'] });
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: ['report'] });
          setPassed(true);
        } else {
          setFeedback(result.feedback);
        }
      })
      .catch((submitError: unknown) => {
        if (submitError instanceof ApiRequestError && submitError.status === 401) {
          queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
          void navigate({ to: '/sign-in' });
          return;
        }
        setError('The coach could not be reached. Nothing was saved. Please try again.');
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  if (passed) {
    return (
      <Text as="p" display="block" className="text-sm text-primary" role="status">
        The coach is satisfied! +100 XP earned.
      </Text>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 border-t border-border pt-3"
      onSubmit={handleSubmit}
      aria-label="Take this assessment"
    >
      <Field
        label="In your own words, what is the core idea of this concept?"
        inputID={`assessment-summary-${item.id}`}
        status={error === undefined ? undefined : { type: 'error', message: error }}
      >
        <textarea
          id={`assessment-summary-${item.id}`}
          name={`assessment-summary-${item.id}`}
          rows={4}
          maxLength={2000}
          value={summary}
          onChange={(event) => {
            setSummary(event.target.value);
            setError(undefined);
          }}
          placeholder="Briefly summarize the key takeaway..."
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={
            error === undefined ? undefined : `assessment-summary-${item.id}-status`
          }
          className={summaryClassName}
        />
      </Field>
      {feedback !== null ? (
        <Text as="p" display="block" type="supporting" className="text-sm" role="status">
          {feedback}
        </Text>
      ) : null}
      <Button
        type="submit"
        label={submitting ? 'The coach is thinking...' : 'Submit to coach'}
        variant="primary"
        isDisabled={submitting}
        isLoading={submitting}
        className="min-h-11 press"
      />
    </form>
  );
}

/** One assigned resource, open until its assessment passes. */
function CurriculumCard({ item }: { item: ActionItemRow }) {
  const [open, setOpen] = useState(false);
  const completed = item.status === 'completed';
  const overdue = !completed && new Date(item.dueAt).getTime() < Date.now();

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge label={TIER_LABEL[item.tier]} variant="neutral" />
        <Badge label="+100 XP" variant="neutral" />
        {completed ? (
          <Badge label="Assessment passed" variant="success" />
        ) : overdue ? (
          <Badge label="Overdue" variant="warning" />
        ) : null}
      </div>
      <div className="space-y-1">
        <Heading level={3}>{item.label} mastery</Heading>
        <Text as="p" display="block" type="supporting" className="text-sm">
          The coach assigned this resource to close your gap in this pattern.
        </Text>
        <Link
          href={`https://www.google.com/search?q=${encodeURIComponent(stripTierTag(item.resource))}`}
          className="min-h-11 items-center"
        >
          {stripTierTag(item.resource)}
        </Link>
      </div>
      {completed ? (
        <div className="space-y-1">
          {item.completedAt !== null ? (
            <Text as="p" display="block" type="supporting" className="text-sm">
              Passed on {completedFormatter.format(new Date(item.completedAt))}
            </Text>
          ) : null}
          {item.summary !== null ? (
            <Text as="p" display="block" type="supporting" className="text-sm">
              {item.summary}
            </Text>
          ) : null}
        </div>
      ) : (
        <div>
          <Link
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="min-h-11 items-center"
          >
            {open ? 'Cancel' : 'Take assessment'}
          </Link>
          {open ? <AssessmentForm item={item} /> : null}
        </div>
      )}
    </Card>
  );
}

/**
 * ST-107. The training curriculum: every assigned action item, one card each,
 * split into pending and completed tabs. A pending card closes only through
 * its coach-graded assessment.
 */
export function CurriculumRoute() {
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const itemsQuery = useQuery(actionItemsQueryOptions());

  const header = (
    <header className="reveal-in space-y-4">
      <Heading level={1}>Training curriculum</Heading>
      <Text as="p" display="block" type="supporting">
        Complete assessments on your assigned resources to demonstrate mastery and earn XP.
      </Text>
    </header>
  );

  if (itemsQuery.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <div className="reveal-in flex justify-center py-16">
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  if (itemsQuery.isError) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          className="reveal-in"
          title="Your curriculum could not be loaded"
          description="Try again in a moment."
          headingLevel={2}
        />
      </div>
    );
  }

  const pending = itemsQuery.data.items.filter((item) => item.status === 'pending');
  const completed = itemsQuery.data.items.filter((item) => item.status === 'completed');
  const shown = tab === 'pending' ? pending : completed;

  return (
    <div className="space-y-6">
      {header}
      <div className="reveal-in flex gap-2" role="tablist" aria-label="Curriculum items">
        <Button
          type="button"
          label={`Pending (${pending.length})`}
          variant={tab === 'pending' ? 'primary' : 'ghost'}
          onClick={() => setTab('pending')}
          role="tab"
          aria-selected={tab === 'pending'}
          className="min-h-11 press"
        />
        <Button
          type="button"
          label={`Completed (${completed.length})`}
          variant={tab === 'completed' ? 'primary' : 'ghost'}
          onClick={() => setTab('completed')}
          role="tab"
          aria-selected={tab === 'completed'}
          className="min-h-11 press"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Your coach assigns resources when your report finds a weakness."
          headingLevel={2}
          actions={
            <Link href="/report" className="min-h-11 items-center">
              Get started
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <li key={item.id}>
              <CurriculumCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
