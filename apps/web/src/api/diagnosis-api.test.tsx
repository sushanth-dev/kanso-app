import { describe, expect, test } from 'vitest';
import { ApiRequestError } from './account-api.ts';
import { createDiagnosisApi } from './diagnosis-api.ts';

const gameId = '00000000-0000-4000-8000-0000000000b1';
const mistakeId = '00000000-0000-4000-8000-0000000000b2';

const gameSummary = { id: gameId, color: 'white' as const, result: 'win' };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContentResponse() {
  return new Response(null, { status: 204 });
}

describe('diagnosis API transport', () => {
  test('gets the report scoped to a stream without extra query params', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ strengths: [], weaknesses: [] }));
    });

    await api.getReport('online');
    const requestUrl = new URL(lastRequest?.url ?? 'about:blank');
    expect(requestUrl.pathname).toBe('/report');
    expect(requestUrl.searchParams.get('stream')).toBe('online');
    expect(requestUrl.searchParams.has('tournament')).toBe(false);
    expect(lastRequest?.credentials).toBe('include');
  });

  test('passes the tournament query through when the report is tournament-scoped', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ strengths: [], weaknesses: [] }));
    });

    await api.getReport('tournament', 't-1');
    expect(new URL(lastRequest?.url ?? 'about:blank').searchParams.get('tournamentId')).toBe('t-1');
  });

  test('lists games capped at one page of 100 with the tournament filter', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ games: [] }));
    });

    await api.listGames('tournament', 't-1');
    const requestUrl = new URL(lastRequest?.url ?? 'about:blank');
    expect(requestUrl.pathname).toBe('/games');
    expect(requestUrl.searchParams.get('stream')).toBe('tournament');
    expect(requestUrl.searchParams.get('limit')).toBe('100');
    expect(requestUrl.searchParams.get('tournament')).toBe('t-1');
  });

  test('gets one game through the path parameter', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ ...gameSummary, moves: [] }));
    });

    await api.getGame(gameId);
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(`/games/${gameId}`);
  });

  test('queues analysis and accepts the 202 accepted response', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(new Response(null, { status: 202 }));
    });

    await expect(api.queueAnalysis(gameId)).resolves.toBeUndefined();
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(`/games/${gameId}/analysis`);
    expect(lastRequest?.method).toBe('POST');
  });

  test('deletes a game on a 204 response', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(noContentResponse());
    });

    await expect(api.deleteGame(gameId)).resolves.toBeUndefined();
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe(`/games/${gameId}`);
    expect(lastRequest?.method).toBe('DELETE');
  });

  test('sets a game colour through a PATCH body', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse(gameSummary));
    });

    expect(await api.setGameColor(gameId, 'black')).toEqual(gameSummary);
    expect(lastRequest?.method).toBe('PATCH');
    expect(await lastRequest?.json()).toEqual({ playerColor: 'black' });
  });

  test('records a practice puzzle attempt and returns the tally', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ solved: 3, attempted: 5 }));
    });

    const input = { puzzleId: 'p-1', kind: 'motif' as const, group: 'endgame-rook', solved: true };
    expect(await api.recordPracticePuzzle(input)).toEqual({ solved: 3, attempted: 5 });
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/practice/puzzles');
    expect(await lastRequest?.json()).toEqual(input);
  });

  test('gets the practice queue and review sections', async () => {
    const requests: Request[] = [];
    const api = createDiagnosisApi((input) => {
      requests.push(input as Request);
      return Promise.resolve(jsonResponse({ pending: [], upcoming: [], mastered: [] }));
    });

    await api.getPracticeQueue();
    expect(new URL(requests[0]?.url ?? 'about:blank').pathname).toBe('/practice/queue');

    await api.listActionItems();
    expect(new URL(requests[1]?.url ?? 'about:blank').pathname).toBe('/report/action-items');
  });

  test('marks an action item done with its summary', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ done: true }));
    });

    await api.markActionItemDone({ actionItemId: 'ai-1', summary: 'Fixed pins.' });
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/report/action-items/done');
    expect(await lastRequest?.json()).toEqual({ actionItemId: 'ai-1', summary: 'Fixed pins.' });
  });

  test('coaches a weakness by id', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ advice: 'Look for skewers.' }));
    });

    await api.coachWeakness({ weaknessId: 'w-1' });
    expect(new URL(lastRequest?.url ?? 'about:blank').pathname).toBe('/report/weakness');
    expect(await lastRequest?.json()).toEqual({ weaknessId: 'w-1' });
  });

  test('gets mistake-level CCT, explanation, and Socratic question endpoints', async () => {
    const requests: Request[] = [];
    const api = createDiagnosisApi((input) => {
      requests.push(input as Request);
      return Promise.resolve(jsonResponse({}));
    });

    await api.getCctScan(mistakeId);
    await api.getExplanation(mistakeId);
    await api.getSocraticQuestion(mistakeId);

    const paths = requests.map((request) => new URL(request.url).pathname);
    expect(paths).toEqual([
      `/mistakes/${mistakeId}/cct`,
      `/mistakes/${mistakeId}/explanation`,
      `/mistakes/${mistakeId}/question`,
    ]);
  });

  test('omits the refresh flag from the transfer-gap query by default', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ gap: 0.2 }));
    });

    await api.getTransferGap();
    const requestUrl = new URL(lastRequest?.url ?? 'about:blank');
    expect(requestUrl.pathname).toBe('/transfer-gap');
    expect(requestUrl.searchParams.has('refresh')).toBe(false);
  });

  test('requests a refreshed transfer gap when asked', async () => {
    let lastRequest: Request | undefined;
    const api = createDiagnosisApi((input) => {
      lastRequest = input as Request;
      return Promise.resolve(jsonResponse({ gap: 0.2 }));
    });

    await api.getTransferGap(true);
    expect(new URL(lastRequest?.url ?? 'about:blank').searchParams.get('refresh')).toBe('true');
  });

  test('throws a typed API error with parsed validation issues', async () => {
    const failedApi = createDiagnosisApi(() =>
      Promise.resolve(
        jsonResponse(
          {
            code: 'validation_failed',
            message: 'Bad request.',
            issues: [{ path: 'kind', message: 'unknown weakness kind' }],
          },
          422,
        ),
      ),
    );

    const puzzles = failedApi.getPracticePuzzles('nope' as never, 'endgame-rook', 'online');
    await expect(puzzles).rejects.toBeInstanceOf(ApiRequestError);
    await expect(puzzles).rejects.toMatchObject({
      status: 422,
      code: 'validation_failed',
      issues: [{ path: 'kind', message: 'unknown weakness kind' }],
      message: 'Bad request.',
    });
  });

  test('rejects a queue-analysis request that misses the 202 contract', async () => {
    const failedApi = createDiagnosisApi(() => {
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'conflict', message: 'Already queued.' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const queue = failedApi.queueAnalysis(gameId);
    await expect(queue).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });

  test('falls back to a default error for a failure without an error payload', async () => {
    const failedApi = createDiagnosisApi(() => Promise.resolve(new Response('', { status: 500 })));

    const report = failedApi.getReport('online');
    await expect(report).rejects.toBeInstanceOf(ApiRequestError);
    await expect(report).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
      message: 'The request failed.',
    });
  });
});
