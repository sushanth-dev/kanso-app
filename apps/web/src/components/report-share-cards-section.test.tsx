import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '../api/account-api.ts';
import { reportShareApi, type ReportCardLink } from '../api/report-share-api.ts';
import { ReportShareCardsSection } from './report-share-cards-section.tsx';

function cardFixture(overrides: Partial<ReportCardLink> = {}): ReportCardLink {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    token: 'c'.repeat(43),
    url: `http://localhost:3000/shared/cards/${'c'.repeat(43)}`,
    createdAt: '2026-09-05T00:00:00.000Z',
    revokedAt: null,
    expiresAt: null,
    ratingLeak: 84,
    label: 'Hanging piece',
    ...overrides,
  };
}

function renderSection(props: { stream: 'online' | 'tournament'; tournamentId?: string | null }) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportShareCardsSection stream={props.stream} tournamentId={props.tournamentId} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReportShareCardsSection', () => {
  test('creates a card of the stream being viewed, with the optional expiry', async () => {
    const user = userEvent.setup();
    const create = vi
      .spyOn(reportShareApi, 'createReportShareCard')
      .mockResolvedValue(cardFixture());
    vi.spyOn(reportShareApi, 'listReportShareCards').mockResolvedValue([]);

    renderSection({ stream: 'tournament', tournamentId: '88888888-8888-4888-8888-888888888888' });

    await screen.findByText('No share cards yet.');
    await user.type(screen.getByLabelText('Expires (optional)'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Create share card' }));
    const [calledBody] = create.mock.calls[0] ?? [];
    expect(calledBody?.stream).toBe('tournament');
    expect(calledBody?.tournamentId).toBe('88888888-8888-4888-8888-888888888888');
    expect(calledBody?.expiresAt?.endsWith('Z')).toBe(true);
  });

  test('creates a stream card without a tournament scope when none is set', async () => {
    const user = userEvent.setup();
    const create = vi
      .spyOn(reportShareApi, 'createReportShareCard')
      .mockResolvedValue(cardFixture());
    vi.spyOn(reportShareApi, 'listReportShareCards').mockResolvedValue([]);

    renderSection({ stream: 'online' });

    await screen.findByText('No share cards yet.');
    await user.click(screen.getByRole('button', { name: 'Create share card' }));

    expect(create).toHaveBeenCalledWith({ stream: 'online' });
  });

  test('lists live cards with their payload, copy, and revoke', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.spyOn(reportShareApi, 'listReportShareCards').mockResolvedValue([cardFixture()]);
    const revoke = vi.spyOn(reportShareApi, 'revokeReportShareCard').mockResolvedValue(undefined);

    renderSection({ stream: 'online' });

    expect(await screen.findByText(/84 rating points - Hanging piece\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/shared/cards/'));

    await user.click(screen.getByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(revoke).toHaveBeenCalledWith(cardFixture().id);
  });

  test('keeps the revoke honest when the API refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(reportShareApi, 'listReportShareCards').mockResolvedValue([cardFixture()]);
    vi.spyOn(reportShareApi, 'revokeReportShareCard').mockRejectedValue(
      new ApiRequestError(500, 'internal_error', undefined, 'Something broke.'),
    );

    renderSection({ stream: 'online' });

    await user.click(await screen.findByRole('button', { name: 'Revoke link' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The card could not be revoked. Please try again.',
    );
  });
});
