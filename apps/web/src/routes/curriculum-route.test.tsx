/**
 * ST-107 coverage, moved here by ST-111: the report no longer lists action
 * items inline, so the assessment loop's tests live on the page that owns it.
 * The pending card closes only through the coach-graded assessment; a pass
 * invalidates the award queries, a fail keeps the form open with feedback.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '../api/account-api.ts';
import { diagnosisApi, type ActionItemDone, type ActionItemList } from '../api/diagnosis-api.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_QUERY_KEY } from '../query-client.ts';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { createAppRouter } from '../router.tsx';
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

  test('ST-142: the page chrome enters through the system, and the tabs hold the touch floor', async () => {
    renderCurriculum([actionItemFixture()]);
    expect(await screen.findByText('Beginner')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Training curriculum' }).closest('.reveal-in'),
    ).not.toBeNull();
    expect(
      screen.getByRole('tablist', { name: 'Curriculum items' }).classList.contains('reveal-in'),
    ).toBe(true);
    for (const name of [/^Pending/, /^Completed/]) {
      expect(screen.getByRole('tab', { name })).toHaveClass('min-h-11');
    }
  });

  test('ST-142: the error and empty states enter through the system, and the links hold the floor', async () => {
    renderCurriculum([]);
    // The empty state is tab-flipped content: it mounts settled instead of
    // replaying the entrance on every tab change.
    expect(
      (await screen.findByRole('heading', { name: 'No items yet' })).closest('.reveal-in'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveClass('min-h-11');
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

  test('ST-107: refuses a whitespace-only summary before calling the coach', async () => {
    const user = userEvent.setup();
    renderCurriculum([actionItemFixture()]);
    const markActionItemDone = vi.spyOn(diagnosisApi, 'markActionItemDone');

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      '    ',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    expect(await screen.findByText('Write a short summary of the core idea first.')).toBeVisible();
    expect(markActionItemDone).not.toHaveBeenCalled();
  });

  test('ST-107: sends the coach the trimmed summary', async () => {
    const user = userEvent.setup();
    renderCurriculum([actionItemFixture()]);
    const markActionItemDone = vi.spyOn(diagnosisApi, 'markActionItemDone').mockResolvedValue({
      pass: true,
      feedback: 'Exactly right.',
      completedAt: new Date().toISOString(),
    });

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      '  Count the captures before moving. ',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    expect(await screen.findByText('The coach is satisfied! +100 XP earned.')).toBeVisible();
    expect(markActionItemDone).toHaveBeenCalledWith({
      actionItemId: 'ai-1',
      summary: 'Count the captures before moving.',
    });
  });

  test('ST-107: offers a retry when the coach cannot be reached', async () => {
    const user = userEvent.setup();
    renderCurriculum([actionItemFixture()]);
    vi.spyOn(diagnosisApi, 'markActionItemDone').mockRejectedValue(new Error('socket hang up'));

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      'Something concrete.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    expect(
      await screen.findByText(
        'The coach could not be reached. Nothing was saved. Please try again.',
      ),
    ).toBeVisible();
    // The attempt survives so the player can resubmit it.
    expect(screen.getByRole('button', { name: 'Submit to coach' })).toBeEnabled();
  });

  test('ST-107: a 401 from the coach clears the session and sends the player to sign-in', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const history = createMemoryHistory();
    const router = createAppRouter({ history, queryClient });
    queryClient.setQueryData(ME_QUERY_KEY, { userId: 'user-1' });
    vi.spyOn(diagnosisApi, 'listActionItems').mockResolvedValue({ items: [actionItemFixture()] });
    vi.spyOn(diagnosisApi, 'markActionItemDone').mockRejectedValue(
      new ApiRequestError(401, 'unauthorized', undefined, 'No session.'),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <CurriculumRoute />
        </RouterContextProvider>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    await user.type(
      screen.getByLabelText('In your own words, what is the core idea of this concept?'),
      'Something concrete.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit to coach' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
      expect(history.location.pathname).toBe('/sign-in');
    });
  });

  test('ST-107: shows the deal-in-progress state while the list loads', async () => {
    const { promise } = Promise.withResolvers<ActionItemList>();
    vi.spyOn(diagnosisApi, 'listActionItems').mockReturnValue(promise);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CurriculumRoute />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Training curriculum' })).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  test('ST-107: explains an unloadable curriculum instead of showing items', async () => {
    vi.spyOn(diagnosisApi, 'listActionItems').mockRejectedValue(new Error('boom'));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CurriculumRoute />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Your curriculum could not be loaded')).toBeVisible();
    expect(screen.getByText('Try again in a moment.')).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  test('ST-107: an empty pending tab points back to the report', async () => {
    renderCurriculum([]);

    expect(await screen.findByText('No items yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/report');
    expect(screen.getByRole('tab', { name: 'Pending (0)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Completed (0)' })).toBeVisible();
  });

  test('ST-107: splits items into pending and completed tabs', async () => {
    const user = userEvent.setup();
    renderCurriculum([
      actionItemFixture(),
      actionItemFixture({ id: 'ai-2', label: 'Weak open file' }),
      actionItemFixture({ id: 'ai-3', label: 'Endgame technique', status: 'completed' }),
    ]);

    expect(await screen.findByRole('tab', { name: 'Pending (2)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Completed (1)' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Pending (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('tab', { name: 'Completed (1)' }));

    expect(await screen.findByRole('tab', { name: 'Completed (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Endgame technique mastery' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Missed captures mastery' }),
    ).not.toBeInTheDocument();
  });

  test('ST-107: a completed item without a date or summary shows only the badge', async () => {
    const user = userEvent.setup();
    renderCurriculum([
      actionItemFixture({ id: 'ai-3', status: 'completed', completedAt: null, summary: null }),
    ]);

    await user.click(await screen.findByRole('tab', { name: /Completed/ }));

    expect(await screen.findByText('Assessment passed')).toBeVisible();
    expect(screen.queryByText(/^Passed on /)).not.toBeInTheDocument();
  });

  test('ST-107: a completed item shows the summary the coach accepted', async () => {
    const user = userEvent.setup();
    renderCurriculum([
      actionItemFixture({
        id: 'ai-3',
        status: 'completed',
        completedAt: '2026-08-31T10:00:00.000Z',
        summary: 'Before moving, count what each capture wins.',
      }),
    ]);

    await user.click(await screen.findByRole('tab', { name: /Completed/ }));

    expect(await screen.findByText('Before moving, count what each capture wins.')).toBeVisible();
  });

  test('ST-107: cancelling collapses the assessment form', async () => {
    const user = userEvent.setup();
    renderCurriculum([actionItemFixture()]);

    await user.click(await screen.findByRole('button', { name: 'Take assessment' }));
    expect(screen.getByRole('form', { name: 'Take this assessment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('form', { name: 'Take this assessment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take assessment' })).toBeVisible();
  });
});
