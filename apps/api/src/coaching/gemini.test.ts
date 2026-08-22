import { afterEach, describe, expect, test, vi } from 'vitest';
import { httpGeminiClient, type GeminiConfig, type MistakeFacts } from './gemini.ts';

const config: GeminiConfig = { apiKey: 'test_key', model: 'gemini-2.0-flash' };

const facts: MistakeFacts = {
  moveNumber: 23,
  movingColor: 'white',
  phase: 'middlegame',
  moveSan: 'Nxd5',
  bestMoveSan: 'Nf3',
  judgement: 'blunder',
  evalBeforeCp: 40,
  evalBeforeMate: null,
  evalAfterCp: -240,
  evalAfterMate: null,
  cpLoss: 280,
  motif: 'hanging_piece',
  opening: 'Sicilian Defense',
  eco: 'B20',
};

function stubResponse(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
  });
}

describe('httpGeminiClient.explainMistake', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('posts the fact set and returns the model text', async () => {
    const fetcher = vi.fn().mockResolvedValue(stubResponse('You left your knight hanging.'));
    vi.stubGlobal('fetch', fetcher);

    const text = await httpGeminiClient(config).explainMistake(facts);

    expect(text).toBe('You left your knight hanging.');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test_key',
    );
    const body = JSON.parse(init.body as string) as { contents: { parts: { text: string }[] }[] };
    const prompt = body.contents[0]!.parts[0]!.text;
    expect(prompt).toContain('Nxd5');
    expect(prompt).toContain('Nf3');
    expect(prompt).toContain('blunder');
    expect(prompt).toContain('Sicilian Defense');
  });

  test('throws rather than substituting canned text on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(httpGeminiClient(config).explainMistake(facts)).rejects.toThrow();
  });

  test('throws when the response has no candidate text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(httpGeminiClient(config).explainMistake(facts)).rejects.toThrow();
  });
});

describe('httpGeminiClient.askSocraticQuestion', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns the model question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(stubResponse('What was on d5 before you moved?')),
    );
    const question = await httpGeminiClient(config).askSocraticQuestion(facts);
    expect(question).toBe('What was on d5 before you moved?');
  });
});
