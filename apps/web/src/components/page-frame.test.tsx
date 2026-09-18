/**
 * The account shell's brand: the wordmark is a link to the product's front
 * door - the report for a signed-in account, the landing page otherwise
 * (ST-124).
 *
 * The signed-in answer comes from the session probe, which answers 200 to
 * everybody, so a signed-out visitor on a public page logs no 401 (ST-164).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi } from '../api/account-api.ts';
import { createAppRouter } from '../router.tsx';
import { StatusMessageProvider } from './status-message.tsx';
import { PageFrame } from './page-frame.tsx';

function renderFrame() {
  const history = createMemoryHistory({ initialEntries: ['/puzzles'] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  return render(
    <QueryClientProvider client={queryClient}>
      <StatusMessageProvider>
        <RouterContextProvider router={router}>
          <PageFrame>
            <p>Content</p>
          </PageFrame>
        </RouterContextProvider>
      </StatusMessageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(accountApi, 'getSession');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageFrame brand link', () => {
  test('a signed-in account links the wordmark to the report', async () => {
    vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: true });
    renderFrame();
    const brand = await screen.findByRole('link', { name: 'Kanso Chess' });
    await waitFor(() => expect(brand.getAttribute('href')).toBe('/report'));
  });

  test('a signed-out visitor links the wordmark to the landing page', async () => {
    vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: false });
    renderFrame();
    const brand = await screen.findByRole('link', { name: 'Kanso Chess' });
    await waitFor(() => expect(brand.getAttribute('href')).toBe('/'));
  });

  test('asks the session probe and never /me, so a public page logs no 401', async () => {
    const getMe = vi.spyOn(accountApi, 'getMe');
    vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: false });
    renderFrame();
    await screen.findByRole('link', { name: 'Kanso Chess' });
    expect(getMe).not.toHaveBeenCalled();
  });
});
