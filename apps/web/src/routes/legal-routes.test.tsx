import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { accountApi } from '../api/account-api.ts';
import { LEGAL_LINKS } from '../content/legal/index.ts';
import { createAppRouter } from '../router.tsx';

function renderAt(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

const POLICY_PAGES: [string, string][] = [
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/about', 'About'],
  ['/contact', 'Contact'],
];

describe('the policy pages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test.each(POLICY_PAGES)(
    '%s renders its heading without asking for a session',
    async (path, heading) => {
      const getSession = vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: false });
      renderAt(path);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      // These four render outside the shell, so neither the shell's probe nor
      // the landing route's runs: a reader with no account makes no request.
      expect(getSession).not.toHaveBeenCalled();
    },
  );

  test('carries the date a change is announced by', async () => {
    renderAt('/privacy');

    expect(
      await screen.findByText(
        'Last updated 18 September 2026. A change to this page is announced by that date.',
      ),
    ).toBeInTheDocument();
  });

  test('states the under-13 gate and the consent link on the privacy page', async () => {
    renderAt('/privacy');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Children under 13' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/requires a parent or guardian's email address/)).toBeInTheDocument();
    expect(screen.getByText(/stops working after three days/)).toBeInTheDocument();
    expect(
      screen.getByText(/Children's Online Privacy Protection Act \(COPPA\)/),
    ).toBeInTheDocument();
  });

  test('states the plan limits and that nothing renews on the terms page', async () => {
    renderAt('/terms');

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Nothing renews by itself, and nothing expires',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Intermediate is 799 rupees a month/)).toBeInTheDocument();
    expect(
      screen.getByText(/no further charge can be made against the account/),
    ).toBeInTheDocument();
  });

  test('carries the published address on the contact page', async () => {
    renderAt('/contact');

    expect(await screen.findByText(/hello@kansochess\.app/)).toBeInTheDocument();
  });
});

describe('the footer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: false });
  });

  test.each(['/privacy', '/', '/sign-up'])('%s reaches all four policy pages', async (path) => {
    renderAt(path);

    const nav = await screen.findByRole('navigation', { name: 'Policy pages' });
    for (const link of LEGAL_LINKS) {
      expect(within(nav).getByRole('link', { name: link.label })).toHaveAttribute(
        'href',
        link.href,
      );
    }
  });
});

describe('an unknown path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(accountApi, 'getSession').mockResolvedValue({ signedIn: false });
  });

  test('renders a designed surface with a way back, not the bare string', async () => {
    renderAt('/this-page-does-not-exist');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'That page does not exist' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Not Found')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the home page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
  });

  test('the way back reaches the landing page', async () => {
    renderAt('/this-page-does-not-exist');

    fireEvent.click(await screen.findByRole('button', { name: 'Go to the home page' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Know the one thing to fix after every tournament.',
      }),
    ).toBeInTheDocument();
  });
});
