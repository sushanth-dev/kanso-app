import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { describe, expect, test } from 'vitest';
import { createAppRouter } from '../router.tsx';

function renderLanding() {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const queryClient = new QueryClient();
  const router = createAppRouter({ history, queryClient });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('LandingRoute', () => {
  test('states the promise, the free promise, and the parent line', async () => {
    renderLanding();

    expect(
      await screen.findByRole('heading', {
        name: 'Know the one thing to fix after every tournament.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your first diagnosis is free/)).toBeInTheDocument();
    expect(
      screen.getByText(/it makes every lesson you already pay for work harder/),
    ).toBeInTheDocument();
  });

  test('shows a synthetic, labelled sample diagnosis, not a real player', async () => {
    renderLanding();

    expect(await screen.findByText('Synthetic example')).toBeInTheDocument();
    expect(screen.getByText(/A scholastic tournament/)).toBeInTheDocument();
    expect(screen.getByText('Missing tactics in the middlegame')).toBeInTheDocument();
    expect(screen.getByText('Tactical motif')).toBeInTheDocument();
  });

  test('states the free and paid boundary factually', async () => {
    renderLanding();

    expect(await screen.findByRole('heading', { name: 'Free today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Paid for the loop' })).toBeInTheDocument();
    expect(screen.getByText(/From ₹799 a month, uncapped on the Pro plan/)).toBeInTheDocument();
  });

  test('routes the join call to action to sign-up', async () => {
    renderLanding();

    const joins = await screen.findAllByRole('link', { name: 'Get your free diagnosis' });
    expect(joins).toHaveLength(2);
    for (const link of joins) {
      expect(link).toHaveAttribute('href', '/sign-up');
    }
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Already have an account? Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });
});
