import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createTournamentApi } from './tournament-api.ts';

const tournamentId = '00000000-0000-4000-8000-0000000000aa';

const tournamentSummary = {
  id: tournamentId,
  name: 'City Open',
  playedAt: '2026-08-30',
};

const roundDecay = {
  tournamentId,
  rounds: [{ round: 1, accuracy: 0.72 }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('tournament API transport', () => {
  test('lists tournaments with cross-origin credentials', async () => {
    let lastRequest: Request | undefined;
    const api = createTournamentApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ tournaments: [tournamentSummary] }));
    });

    const list = await api.listTournaments();
    expect(list).toEqual({ tournaments: [tournamentSummary] });
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/tournaments');
    expect(lastRequest?.method).toBe('GET');
    expect(lastRequest?.credentials).toBe('include');
  });

  test('gets one tournament through the path parameter', async () => {
    let lastRequest: Request | undefined;
    const api = createTournamentApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ ...tournamentSummary, games: [] }));
    });

    await api.getTournament(tournamentId);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(
      `/tournaments/${tournamentId}`,
    );
  });

  test('gets the round decay for a tournament', async () => {
    let lastRequest: Request | undefined;
    const api = createTournamentApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(roundDecay));
    });

    expect(await api.getRoundDecay(tournamentId)).toEqual(roundDecay);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(
      `/tournaments/${tournamentId}/round-decay`,
    );
  });

  test('rejects a tournament the player does not own', async () => {
    const failedApi = createTournamentApi(() =>
      Promise.resolve(jsonResponse({ code: 'not_found', message: 'No such tournament.' }, 404)),
    );

    const getTournament = failedApi.getTournament(tournamentId);
    await expect(getTournament).rejects.toBeInstanceOf(ApiRequestError);
    await expect(getTournament).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      issues: undefined,
      message: 'No such tournament.',
    });
  });
});
