/**
 * ST-153. The manifest is the extension's security surface: what it matches,
 * what it may call, and nothing more. These tests keep the content script's
 * page scope narrow and the host permission pinned to the API alone.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf8'),
) as {
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[]; js: string[] }[];
};

describe('the extension manifest', () => {
  test('needs no more than the storage permission', () => {
    expect(manifest.permissions).toEqual(['storage']);
  });

  test('calls the API origin and nothing else', () => {
    expect(manifest.host_permissions).toEqual(['https://api.kansochess.app/*']);
  });

  test('runs one content script on the two new-game entry points', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    const script = manifest.content_scripts[0]!;
    expect(script.js).toEqual(['content.js']);
    expect(script.matches).toContain('https://www.chess.com/play/online/new*');
    expect(script.matches).toContain('https://lichess.org/*');
    expect(script.matches).toHaveLength(2);
  });
});
