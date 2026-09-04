import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { assignmentApi, type AssignmentLink } from '../api/assignment-api.ts';
import type { FocusCatalogueEntry } from '../api/focus-api.ts';
import { AssignmentLinksSection } from './assignment-links-section.tsx';

const timeManagement: FocusCatalogueEntry = {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'time_management',
  title: 'Time management',
  description: 'Using the clock so the position decides the game, not the flag.',
  measureDescription: 'The move where time trouble begins.',
  measurableStreams: ['online'],
  version: 1,
};

function linkFixture(overrides: Partial<AssignmentLink> = {}): AssignmentLink {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    token: 't'.repeat(43),
    url: 'http://localhost:3000/shared/assignments/ttttttttttttttttttttttttttttttttttttttttttt',
    createdAt: '2026-09-04T00:00:00.000Z',
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function renderSection(
  catalogue: FocusCatalogueEntry[] = [timeManagement],
  activeCatalogueKey: string | null = null,
) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AssignmentLinksSection catalogue={catalogue} activeCatalogueKey={activeCatalogueKey} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssignmentLinksSection', () => {
  test('creates a link from the chosen focus and the instruction, and resets the form', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(assignmentApi, 'createAssignmentLink').mockResolvedValue(linkFixture());
    vi.spyOn(assignmentApi, 'listAssignmentLinks').mockResolvedValue([]);

    renderSection();

    await screen.findByText('No assignment links yet.');
    await user.selectOptions(screen.getByLabelText(/The focus the coach assigned/), [
      'time_management',
    ]);
    await user.type(screen.getByLabelText(/The coach's instruction/), 'Thirty minutes a day.');
    await user.click(screen.getByRole('button', { name: 'Create an assignment link' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        catalogueKey: 'time_management',
        instruction: 'Thirty minutes a day.',
      });
    });
  });

  test('carries the optional expiry date as the end of that day', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(assignmentApi, 'createAssignmentLink').mockResolvedValue(linkFixture());
    vi.spyOn(assignmentApi, 'listAssignmentLinks').mockResolvedValue([]);

    renderSection();

    await screen.findByText('No assignment links yet.');
    await user.selectOptions(screen.getByLabelText(/The focus the coach assigned/), [
      'time_management',
    ]);
    await user.type(screen.getByLabelText(/The coach's instruction/), 'Thirty minutes a day.');
    await user.type(screen.getByLabelText(/Expires/), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Create an assignment link' }));

    await waitFor(() => {
      expect(create.mock.calls[0]?.[0].expiresAt?.endsWith('Z')).toBe(true);
    });
  });

  test('refuses an empty form with the honest reason, without calling the API', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(assignmentApi, 'createAssignmentLink');
    vi.spyOn(assignmentApi, 'listAssignmentLinks').mockResolvedValue([]);

    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Create an assignment link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose the focus the coach assigned.',
    );
    expect(create).not.toHaveBeenCalled();
  });

  test('lists live links with copy and revoke, and drops them on revoke', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.spyOn(assignmentApi, 'listAssignmentLinks').mockResolvedValue([
      linkFixture({ id: '44444444-4444-4444-8444-444444444444' }),
    ]);
    const revoke = vi.spyOn(assignmentApi, 'revokeAssignmentLink').mockResolvedValue(undefined);

    renderSection();

    expect(await screen.findByText(/shared\/assignments\//)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/shared/assignments/'));

    await user.click(screen.getByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
    });
  });

  test('says the focus is gone when the catalogue refused the create', async () => {
    const user = userEvent.setup();
    vi.spyOn(assignmentApi, 'createAssignmentLink').mockRejectedValue(
      new ApiRequestError(404, 'not_found', undefined, 'No such catalogue key.'),
    );
    vi.spyOn(assignmentApi, 'listAssignmentLinks').mockResolvedValue([]);

    renderSection();

    await screen.findByText('No assignment links yet.');
    await user.selectOptions(screen.getByLabelText(/The focus the coach assigned/), [
      'time_management',
    ]);
    await user.type(screen.getByLabelText(/The coach's instruction/), 'Thirty minutes a day.');
    await user.click(screen.getByRole('button', { name: 'Create an assignment link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That focus is no longer available. Choose another.',
    );
  });
});
