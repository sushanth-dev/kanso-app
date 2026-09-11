/**
 * ST-153. The content script: runs on the new-game pages, asks the service
 * worker for the brief, and renders the card. It holds no token and makes no
 * network call of its own.
 *
 * Fail-silent in both directions: a null brief removes any card rather than
 * leaving a stale one, and every failure is swallowed because a chess page
 * that misbehaves is worse than no primer.
 */
import { renderCard } from './card.ts';

const CARD_ID = 'kansochess-priming-card';

async function prime(): Promise<void> {
  try {
    const brief = await chrome.runtime.sendMessage({ type: 'priming-brief' });
    renderCard(document.body, brief);
  } catch {
    document.getElementById(CARD_ID)?.remove();
  }
}

void prime();
