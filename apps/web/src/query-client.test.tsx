/**
 * ST-164. Both query keys hold session truth: the account itself and the probe
 * that says whether there is one. One helper owns clearing them, so sign-out
 * cannot clear one and leave the other to disagree.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import { clearSessionState, ME_QUERY_KEY, SESSION_QUERY_KEY } from './query-client.ts';

describe('clearSessionState', () => {
  test('drops the account and marks the session probe stale', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, { userId: 'user-1' });
    queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: true });

    clearSessionState(queryClient);

    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
    // Marked stale rather than dropped: a mounted reader holds the value it
    // already rendered, so invalidation is the only thing that makes it ask
    // again. Removing the query leaves the shell showing the old answer.
    expect(queryClient.getQueryState(SESSION_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  test('is harmless when neither key holds data', () => {
    const queryClient = new QueryClient();

    expect(() => clearSessionState(queryClient)).not.toThrow();
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined();
    expect(queryClient.getQueryState(SESSION_QUERY_KEY)).toBeUndefined();
  });
});
