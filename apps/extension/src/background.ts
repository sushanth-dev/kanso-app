/**
 * ST-153. The service worker: the only place the token and the network call
 * live. The content script never sees the token; it asks this worker for the
 * brief and gets validated data or nothing.
 *
 * Fail-silent: any failure, a missing token included, answers null and the
 * page shows no card. The worker asks the brief endpoint on demand, one
 * request per new-game page load, and the endpoint's rate limit (five reads
 * a minute) bounds the worst case.
 */
import { isBrief } from './brief.ts';

const TOKEN_KEY = 'primingToken';

/** The deployed API origin. Override via storage for local development. */
const API_ORIGIN = 'https://api.kansochess.app';

async function readToken(): Promise<string | null> {
  const stored = await chrome.storage.sync.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export async function fetchBrief(token: string): Promise<unknown> {
  const response = await fetch(`${API_ORIGIN}/priming/brief`, {
    headers: { authorization: `Bearer ${token}` },
    credentials: 'omit',
  });
  if (response.status !== 200) return null;
  return response.json();
}

async function briefForPage(): Promise<unknown> {
  try {
    const token = await readToken();
    if (token === null) return null;
    const body = await fetchBrief(token);
    return isBrief(body) ? body : null;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  void briefForPage().then((brief) => sendResponse(brief));
  return true;
});
