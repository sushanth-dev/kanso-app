// @vitest-environment jsdom
/**
 * ST-153. The card renderer: what a valid brief becomes on the page, what an
 * invalid one leaves behind (nothing), and the fifteen-second self-dismiss.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AUTO_DISMISS_MS, CARD_ID, formatGroup, renderCard } from './card.ts';

const brief = {
  groups: [
    { label: 'Hanging piece', stream: 'online', weekCount: 4 },
    { label: 'Bxh7 ideas', stream: 'tournament', weekCount: 1 },
  ],
  focusLabel: 'Loose pieces drop off',
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('renderCard', () => {
  test('renders each group and the focus line, with a dismiss button', () => {
    const card = renderCard(document.body, brief);
    expect(card).not.toBeNull();
    expect(document.getElementById(CARD_ID)).not.toBeNull();
    expect(document.body.textContent).toContain('Hanging piece - 4 this week');
    expect(document.body.textContent).toContain('Bxh7 ideas - 1 this week');
    expect(document.body.textContent).toContain('Focus: Loose pieces drop off');

    const button = card!.querySelector('button');
    expect(button?.textContent).toBe('Dismiss');
    button!.dispatchEvent(new Event('click'));
    expect(document.getElementById(CARD_ID)).toBeNull();
  });

  test('replaces an earlier card instead of stacking a second one', () => {
    renderCard(document.body, brief);
    renderCard(document.body, brief);
    expect(document.querySelectorAll(`#${CARD_ID}`)).toHaveLength(1);
  });

  test('renders nothing for an empty brief, and clears any stale card', () => {
    renderCard(document.body, brief);
    expect(renderCard(document.body, { groups: [], focusLabel: null })).toBeNull();
    expect(document.getElementById(CARD_ID)).toBeNull();
  });

  test('renders nothing for a brief that fails validation', () => {
    expect(renderCard(document.body, { groups: 'many' })).toBeNull();
    expect(renderCard(document.body, null)).toBeNull();
    expect(document.getElementById(CARD_ID)).toBeNull();
  });

  test('dismisses itself after fifteen seconds', () => {
    vi.useFakeTimers();
    renderCard(document.body, brief);
    expect(document.getElementById(CARD_ID)).not.toBeNull();
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(document.getElementById(CARD_ID)).toBeNull();
  });
});

describe('formatGroup', () => {
  test('joins the label and the week count', () => {
    expect(formatGroup({ label: 'Hanging piece', weekCount: 4 })).toBe(
      'Hanging piece - 4 this week',
    );
  });
});
