/**
 * ST-107 coverage, moved here by ST-111: the report no longer lists action
 * items inline, so the assessment loop's tests live on the page that owns it.
 * The pending card closes only through the coach-graded assessment; a pass
 * invalidates the award queries, a fail keeps the form open with feedback.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { diagnosisApi, type ActionItemDone, type ActionItemList } from '../api/diagnosis-api.ts';
import { ME_QUERY_KEY } from '../query-client.ts';
import { CurriculumRoute } from './curriculum-route.tsx';

type ActionItemRow = ActionItemList['items'][number];

/** One assigned resource; the curriculum the coach closes per item. */
function actionItemFixture(overrides: Partial<ActionItemRow> = {}): ActionItemRow {
  return {
    id: 'ai-1',
    resourceIndex: 0,
    kind: 'motif',
    label: 'Missed captures',
    summary: null,
    tier: 'beginner',
    resource: '[beginner] Laszlo Polgar - Chess: 5334 Problems, problems #1800-#1900',
    status: 'pending',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function renderCurriculum(items: ActionItemRow[]) {
  const queryClient = new QueryClient();
  vi.spyOn(diagnosisApi, 'listActionItems').mockResolvedValue({ items });
  render(
    <QueryClientProvider client={queryClient}>
      <CurriculumRoute />
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe('CurriculumRoute', () => {
  beforeEach(() => {
    // Spies are not auto-restored in this file; call history leaks between
    // tests otherwise.
    vi.clearAllMocks();
  });

  test('ST-107: lists a pending action item with its tier, resource, and an assessment link', async () => {
    renderCurriculum([actionItemFixture()]);
    // The tier tag is data for the badge, noise for the resource link.
    expect(await screen.findByText('Beginner')).toBeVisible();
    const resourceName = 'Laszlo Polgar - Chess: 5334 Problems, problems #1800-#1900';
    expect(screen.getByRole('link', { name: resourceName }).getAttribute('href')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent(resourceName)}`,
    );
    expect(screen.getByRole('button', { name: 'Take assessment' })).toBeInTheDocument();
  });

  test('ST-107: flags a pending action item past its due date', async () => {
    renderCurriculum([
      actionItemFixture({ dueAt: new Date(Date.now() - 86_400_000).toISOString() }),
    ]);
    expect(await screen.findByText('Overdue')).toBeVisible();
  });

  test('ST-107: shows the passed badge on a completed item', async () => {
    const user = userEvent.setup();
    const completedAt = '2026-08-31T10:00:00.000Z';
    renderCurriculum([actionItemFixture({ status: 'completed', completedAt })]);
    await user.click(await screen.findByRole('tab', { name: /Completed/ }));
    expect(await screen.findByText('Assessment passed')).toBeVisible();
    const passedOn = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(completedAt));
    expect(screen.getByText(`Passed on ${passedOn}`)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Take assessment' })).toBeNull();
  });

  test('ST-107: a passed assessment invalidates the list, the award, and the report', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderCurriculum([actionItemFixture()]);
    // The web tsconfig's lib predates es2024, so the resolvers helper is not
    // in view here; the executor form is the compiler's requirement, not a
    // style choice.
    let resolveCoach: (result: ActionItemDone) => void = () => {};
    const markActionItemDone = vi.spyOn(diagnosisApi, 'markActionItemDone').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCoach = resolve;
        }),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    expect(screen.getByRole('form', { name: 'Take this assessment' })).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      'Before every move, count what each available capture wins.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    // The coach is judging while the request runs.
    expect(await screen.findByText('The coach is thinking...')).toBeVisible();
    expect(markActionItemDone).toHaveBeenCalledWith({
      actionItemId: 'ai-1',
      summary: 'Before every move, count what each available capture wins.',
    });

    resolveCoach({
      pass: true,
      feedback: 'Exactly right.',
      completedAt: new Date().toISOString(),
    });
    await waitFor(() => {
      expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
        ['action-items'],
        ME_QUERY_KEY,
        ['report'],
      ]);
    });
  });

  test('ST-107: a rejected assessment keeps the form open with the feedback', async () => {
    const user = userEvent.setup();
    renderCurriculum([actionItemFixture()]);
    vi.spyOn(diagnosisApi, 'markActionItemDone').mockResolvedValue({
      pass: false,
      feedback: 'Name one concrete idea from the resource and why it matters.',
      completedAt: null,
    });

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      'Details here.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    expect(
      await screen.findByText('Name one concrete idea from the resource and why it matters.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit to coach' })).toBeVisible();
  });

  test('ST-107: refuses an empty summary before calling the coach', async () => {
    const user = userEvent.setup();
    renderCurriculum([actionItemFixture()]);
    const markActionItemDone = vi.spyOn(diagnosisApi, 'markActionItemDone');

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    expect(await screen.findByText('Write a short summary of the core idea first.')).toBeVisible();
    expect(markActionItemDone).not.toHaveBeenCalled();
  });
});
