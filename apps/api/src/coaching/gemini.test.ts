import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  httpGeminiClient,
  type GeminiConfig,
  type MistakeFacts,
  type ReportAdviceFacts,
} from './gemini.ts';

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

const reportFacts: ReportAdviceFacts[] = [
  {
    kind: 'motif',
    label: 'Hanging piece',
    occurrences: 23,
    halfPointsLost: 5.5,
    gamesAffected: 7,
    ratingLeak: 800,
    saturated: true,
    gamesCovered: 28,
    instances: [
      { moveNumber: 45, moveSan: 'Qxc4', bestMoveSan: 'Qe3', judgement: 'blunder', cpLoss: 301 },
      { moveNumber: 46, moveSan: 'bxa4', bestMoveSan: 'Ra1', judgement: 'mistake', cpLoss: 230 },
    ],
  },
];

describe('httpGeminiClient.adviseWeaknesses', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the fact set as data with the array instruction, and nothing else', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        stubResponse('["Slow down in the move 45-46 stretch: check captures first."]'),
      );
    vi.stubGlobal('fetch', fetcher);

    const lines = await httpGeminiClient(config).adviseWeaknesses(reportFacts);
    expect(lines).toEqual(['Slow down in the move 45-46 stretch: check captures first.']);
    // The house pattern: destructure the request init, then parse the body.
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      contents: { parts: { text: string }[] }[];
      generationConfig?: { responseMimeType?: string };
    };
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
    const prompt = body.contents[0]!.parts[0]!.text;
    // Golden: the fact set rides as data, the rules as instructions.
    expect(prompt).toContain('"label": "Hanging piece"');
    expect(prompt).toContain('"moveNumber": 45');
    expect(prompt).toContain('"saturated": true');
    expect(prompt).toContain('JSON array of strings');
    // ADR-0018: no position, no names, no identifiers ever reach the model.
    expect(prompt).not.toMatch(/rnbq/i);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(prompt).not.toContain('White');
    expect(prompt).not.toContain('Black');
  });

  test('rejects a response that is not an array aligned to the fact set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stubResponse('["one", "two"]')));
    await expect(httpGeminiClient(config).adviseWeaknesses(reportFacts)).rejects.toThrow();
  });

  test('strips markdown fences around the array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stubResponse('```json\n["a"]\n```')));
    await expect(httpGeminiClient(config).adviseWeaknesses(reportFacts)).resolves.toEqual(['a']);
  });

  test('propagates a provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(httpGeminiClient(config).adviseWeaknesses(reportFacts)).rejects.toThrow();
  });
});
