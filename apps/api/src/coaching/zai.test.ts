import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  httpZaiClient,
  zaiConfigFromEnv,
  type MistakeFacts,
  type ReportAdviceFacts,
  type ReportSummaryFacts,
  type ZaiConfig,
} from './zai.ts';

const config: ZaiConfig = { apiKey: 'test_key', model: 'glm-5.3-flash' };

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
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
  });
}

describe('zaiConfigFromEnv', () => {
  test('reads ZAI_API_KEY and defaults the model to glm-5.3-flash', () => {
    expect(zaiConfigFromEnv({ ZAI_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      model: 'glm-5.3-flash',
    });
  });

  test('honours ZAI_MODEL when set', () => {
    expect(zaiConfigFromEnv({ ZAI_API_KEY: 'k', ZAI_MODEL: 'glm-5.3' })).toEqual({
      apiKey: 'k',
      model: 'glm-5.3',
    });
  });

  test('is null without a key, which is what keeps the layer unmounted', () => {
    expect(zaiConfigFromEnv({})).toBeNull();
  });
});

describe('httpZaiClient.explainMistake', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('posts the fact set with bearer auth and returns the model text', async () => {
    const fetcher = vi.fn().mockResolvedValue(stubResponse('You left your knight hanging.'));
    vi.stubGlobal('fetch', fetcher);

    const text = await httpZaiClient(config).explainMistake(facts);

    expect(text).toBe('You left your knight hanging.');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test_key');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('glm-5.3-flash');
    const prompt = body.messages[0]!.content;
    expect(prompt).toContain('Nxd5');
    expect(prompt).toContain('Nf3');
    expect(prompt).toContain('blunder');
    expect(prompt).toContain('Sicilian Defense');
  });

  test('throws rather than substituting canned text on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(httpZaiClient(config).explainMistake(facts)).rejects.toThrow();
  });

  test('throws when the response has no message content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(httpZaiClient(config).explainMistake(facts)).rejects.toThrow();
  });
});

describe('httpZaiClient.askSocraticQuestion', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns the model question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(stubResponse('What was on d5 before you moved?')),
    );
    const question = await httpZaiClient(config).askSocraticQuestion(facts);
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

describe('httpZaiClient.adviseWeaknesses', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the fact set as data with the array instruction, and nothing else', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        stubResponse('["Slow down in the move 45-46 stretch: check captures first."]'),
      );
    vi.stubGlobal('fetch', fetcher);

    const lines = await httpZaiClient(config).adviseWeaknesses(reportFacts);
    expect(lines).toEqual(['Slow down in the move 45-46 stretch: check captures first.']);
    // The house pattern: destructure the request init, then parse the body.
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { content: string }[];
    };
    const prompt = body.messages[0]!.content;
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
    await expect(httpZaiClient(config).adviseWeaknesses(reportFacts)).rejects.toThrow();
  });

  test('strips markdown fences around the array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stubResponse('```json\n["a"]\n```')));
    await expect(httpZaiClient(config).adviseWeaknesses(reportFacts)).resolves.toEqual(['a']);
  });

  test('propagates a provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(httpZaiClient(config).adviseWeaknesses(reportFacts)).rejects.toThrow();
  });
});

const summaryFacts: ReportSummaryFacts = {
  gamesCovered: 28,
  timeTroubleFromMove: 38,
  weaknesses: [
    {
      kind: 'motif',
      label: 'Hanging piece',
      eco: null,
      occurrences: 23,
      halfPointsLost: 5.5,
      gamesAffected: 7,
      ratingLeak: 800,
      saturated: true,
      advice: 'Count defenders on every piece after each opponent move.',
      instances: [
        { moveNumber: 45, moveSan: 'Qxc4', bestMoveSan: 'Qe3', judgement: 'blunder', cpLoss: 301 },
      ],
    },
    {
      kind: 'opening',
      label: 'Sicilian, Alapin',
      eco: 'B22',
      occurrences: 5,
      halfPointsLost: 1.5,
      gamesAffected: 4,
      ratingLeak: 90,
      saturated: false,
      advice: null,
      instances: [],
    },
  ],
};

describe('httpZaiClient.summarizeReport', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the ranked report as data and returns the plan', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(stubResponse('Start with hanging pieces, then the Alapin games.'));
    vi.stubGlobal('fetch', fetcher);

    const plan = await httpZaiClient(config).summarizeReport(summaryFacts);

    expect(plan).toBe('Start with hanging pieces, then the Alapin games.');
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: { content: string }[] };
    const prompt = body.messages[0]!.content;
    // Golden: ranked weaknesses with their instances and advice lines, as data.
    expect(prompt).toContain('"label": "Hanging piece"');
    expect(prompt).toContain('"label": "Sicilian, Alapin"');
    expect(prompt).toContain('"timeTroubleFromMove": 38');
    expect(prompt).toContain('"advice": "Count defenders');
    // ADR-0018: no position, no names, no identifiers ever reach the model.
    expect(prompt).not.toMatch(/rnbq/i);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(prompt).not.toContain('Mina');
  });

  test('propagates a provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(httpZaiClient(config).summarizeReport(summaryFacts)).rejects.toThrow();
  });
});
