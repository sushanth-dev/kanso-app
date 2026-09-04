/**
 * The announcement bar against a mocked posthog-js.
 *
 * The contract under test: the flag's payload is the announcement, a missing
 * or empty flag renders nothing, dismissal persists per browser, and an
 * edited message dismisses fresh. The wire to PostHog (flags request, re-sync
 * timing) is the SDK's; the mock replays the callback the way the real
 * `onFeatureFlags` does on every sync.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const posthogMock = vi.hoisted(() => {
  const state: { listeners: Array<() => void>; payload: unknown } = {
    listeners: [],
    payload: undefined,
  };
  return {
    setPayload: (value: unknown) => {
      state.payload = value;
    },
    reset: () => {
      state.listeners = [];
      state.payload = undefined;
    },
    onFeatureFlags: (cb: () => void) => {
      state.listeners.push(cb);
      return () => {
        state.listeners = state.listeners.filter((l) => l !== cb);
      };
    },
    getFeatureFlagPayload: () => state.payload,
    emit: () => {
      for (const listener of state.listeners) listener();
    },
  };
});

vi.mock('posthog-js', () => ({ default: posthogMock }));

import { AnnouncementBanner, dismissedKeyFor, parseAnnouncement } from './announcement-banner.tsx';

describe('parseAnnouncement', () => {
  test('reads a plain sentence as the message', () => {
    expect(parseAnnouncement('Drills now deal openings')).toEqual({
      message: 'Drills now deal openings',
    });
  });

  test('reads JSON with a message and one link', () => {
    expect(parseAnnouncement('{"message":"New drills","href":"/puzzles"}')).toEqual({
      message: 'New drills',
      href: '/puzzles',
    });
  });

  test('refuses shapes without a message, and empty payloads', () => {
    expect(parseAnnouncement('{"href":"/puzzles"}')).toBeNull();
    expect(parseAnnouncement('')).toBeNull();
    expect(parseAnnouncement(undefined)).toBeNull();
  });
});

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    posthogMock.reset();
  });

  test('shows the flag payload with its link once flags sync', () => {
    posthogMock.setPayload('{"message":"New drills","href":"/puzzles"}');
    render(<AnnouncementBanner />);
    act(() => posthogMock.emit());
    expect(screen.getByRole('region', { name: 'Announcement' })).toBeVisible();
    expect(screen.getByText('New drills')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/puzzles');
  });

  test('renders nothing while the flag is off or the payload empty', () => {
    render(<AnnouncementBanner />);
    act(() => posthogMock.emit());
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull();
  });

  test('dismissing persists per browser, and an edited message shows again', async () => {
    const user = userEvent.setup();
    posthogMock.setPayload('Drills now deal openings');
    const { rerender } = render(<AnnouncementBanner />);
    act(() => posthogMock.emit());

    await user.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
    rerender(<AnnouncementBanner />);
    expect(screen.queryByRole('region', { name: 'Announcement' })).toBeNull();
    expect(window.localStorage.getItem('announcement-dismissed')).toBe(
      dismissedKeyFor('Drills now deal openings'),
    );

    posthogMock.setPayload('The review ladder is live');
    rerender(<AnnouncementBanner />);
    act(() => posthogMock.emit());
    expect(screen.getByText('The review ladder is live')).toBeVisible();
  });
});
