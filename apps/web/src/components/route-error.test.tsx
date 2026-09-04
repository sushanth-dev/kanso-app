/**
 * DEBT-015. The shared error-and-retry state for the account shell: the copy
 * is fixed, and Retry invalidates the router rather than reloading the page.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { RouteError } from './route-error.tsx';

const invalidate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
}));

describe('RouteError', () => {
  test('presents the failure copy and a retry action', () => {
    render(<RouteError />);
    expect(screen.getByRole('heading', { level: 1, name: 'This page could not be loaded' }));
    expect(screen.getByText('Try again, or go back to your account.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('retry invalidates the router so beforeLoad reruns', async () => {
    const user = userEvent.setup();
    render(<RouteError />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
