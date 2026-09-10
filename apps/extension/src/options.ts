/**
 * ST-153. The options page: the token's home in the extension. Paste the
 * secret from KansoChess settings; it is stored in chrome.storage.sync and
 * sent only to the brief endpoint by the service worker.
 */
const TOKEN_KEY = 'primingToken';

const statusLine = document.getElementById('status') as HTMLParagraphElement;
const input = document.getElementById('token') as HTMLInputElement;
const save = document.getElementById('save') as HTMLButtonElement;
const clear = document.getElementById('clear') as HTMLButtonElement;

function showSaved(): void {
  statusLine.textContent = 'Token saved.';
  window.setTimeout(() => {
    statusLine.textContent = '';
  }, 2000);
}

void chrome.storage.sync.get(TOKEN_KEY).then((stored: Record<string, unknown>) => {
  const token = stored[TOKEN_KEY];
  if (typeof token === 'string' && token.length > 0) {
    input.value = token;
    clear.hidden = false;
  }
});

save.addEventListener('click', () => {
  const token = input.value.trim();
  if (token.length === 0) {
    statusLine.textContent = 'Paste the token from KansoChess settings first.';
    return;
  }
  void chrome.storage.sync.set({ [TOKEN_KEY]: token }).then(() => {
    showSaved();
    clear.hidden = false;
  });
});

clear.addEventListener('click', () => {
  void chrome.storage.sync.remove(TOKEN_KEY).then(() => {
    input.value = '';
    statusLine.textContent = 'Token removed.';
    clear.hidden = true;
  });
});
