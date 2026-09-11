/**
 * ST-153. The priming card: a fixed-position panel the content script injects
 * onto the new-game page, dismissed with a click or a fifteen-second timer.
 *
 * The renderer is pure DOM over a validated brief: it receives the element it
 * writes into and the brief it may describe, so tests can run it against a
 * detached node. Fail-silent lives here too - an invalid brief removes any
 * existing card rather than rendering a broken one.
 */
import { isBrief } from './brief.ts';

export const CARD_ID = 'kansochess-priming-card';
/** The card dismisses itself after this long. */
export const AUTO_DISMISS_MS = 15_000;

export function formatGroup(group: { label: string; weekCount: number }): string {
  return `${group.label} - ${group.weekCount} this week`;
}

/**
 * Renders the card into `host`, replacing whatever an earlier render left.
 * Returns the card element. With no brief, or a brief with no groups and no
 * focus, there is nothing to say and any existing card is removed.
 */
export function renderCard(host: HTMLElement, brief: unknown): HTMLElement | null {
  document.getElementById(CARD_ID)?.remove();
  if (!isBrief(brief)) return null;
  if (brief.groups.length === 0 && brief.focusLabel === null) return null;

  const card = document.createElement('aside');
  card.id = CARD_ID;
  card.setAttribute('aria-label', 'KansoChess pre-game primer');

  const title = document.createElement('p');
  title.textContent = 'Before you play';
  card.appendChild(title);

  const list = document.createElement('ul');
  for (const group of brief.groups) {
    const item = document.createElement('li');
    item.textContent = formatGroup(group);
    list.appendChild(item);
  }
  if (brief.focusLabel !== null) {
    const focus = document.createElement('li');
    focus.textContent = `Focus: ${brief.focusLabel}`;
    list.appendChild(focus);
  }
  card.appendChild(list);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => card.remove());
  card.appendChild(dismiss);

  host.appendChild(card);
  window.setTimeout(() => card.remove(), AUTO_DISMISS_MS);
  return card;
}
