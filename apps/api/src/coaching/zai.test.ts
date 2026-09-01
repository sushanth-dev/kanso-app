import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AdviceVerifyFacts,
  CALL_TIMEOUT_MS,
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

  test('treats an empty ZAI_MODEL as unset - the deploy wiring sends one', () => {
    // infra/api.ts interpolates `ZAI_MODEL: process.env.ZAI_MODEL ?? ''`, and
    // an empty model name makes every API call answer 400 modelCode, which
    // silently dropped every report into its template fallback.
    expect(zaiConfigFromEnv({ ZAI_API_KEY: 'k', ZAI_MODEL: '' })).toEqual({
      apiKey: 'k',
      model: 'glm-5.3-flash',
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
      reasoning_effort: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('glm-5.3-flash');
    // Unbounded reasoning measured 78 seconds and 503'd every report read;
    // low effort answers in about four (1 September outage).
    expect(body.reasoning_effort).toBe('low');
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

const verifyFacts: AdviceVerifyFacts = {
  label: 'Hanging piece',
  advice: 'Count defenders on every piece after each opponent move.',
  summary: 'I counted defenders before every capture for a week.',
};

describe('httpZaiClient.verifyAdviceSummary', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends the label, the advice and the summary as data, and nothing else', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        stubResponse('{"pass": true, "feedback": "Good, that is the habit that stops the leaks."}'),
      );
    vi.stubGlobal('fetch', fetcher);

    const verdict = await httpZaiClient(config).verifyAdviceSummary(verifyFacts);

    expect(verdict).toEqual({
      pass: true,
      feedback: 'Good, that is the habit that stops the leaks.',
    });
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: { content: string }[] };
    const prompt = body.messages[0]!.content;
    expect(prompt).toContain('"advice": "Count defenders');
    expect(prompt).toContain('"weakness": "Hanging piece"');
    // ADR-0018: no position, no names, no identifiers ever reach the model.
    expect(prompt).not.toMatch(/rnbq/i);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  test('strips markdown fences around the verdict object', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          stubResponse('```json\n{"pass": false, "feedback": "Name one concrete detail."}\n```'),
        ),
    );
    await expect(httpZaiClient(config).verifyAdviceSummary(verifyFacts)).resolves.toEqual({
      pass: false,
      feedback: 'Name one concrete detail.',
    });
  });

  test('rejects a verdict without a boolean pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stubResponse('{"pass": "yes"}')));
    await expect(httpZaiClient(config).verifyAdviceSummary(verifyFacts)).rejects.toThrow();
  });

  test('rejects a feedback line past the cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(stubResponse(`{"pass": true, "feedback": "${'x'.repeat(281)}"}`)),
    );
    await expect(httpZaiClient(config).verifyAdviceSummary(verifyFacts)).rejects.toThrow();
  });

  test('propagates a provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(httpZaiClient(config).verifyAdviceSummary(verifyFacts)).rejects.toThrow();
  });
});

describe('httpZaiClient.recommendResources', () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = {
    kind: 'motif' as const,
    label: 'Hanging piece',
    eco: null,
    advice: 'Check defenders first.',
    rating: 1500,
  };
  const three = [
    '[Beginner] Laszlo Polgar - Chess: 5334 Problems, problems #1800-#1900',
    '[Intermediate] Yuri Averbakh - Chess Tactics for Advanced Players, Chapter 4',
    '[Advanced] Mark Dvoretsky - Dvoretsky\u2019s Endgame Manual, Chapter 2',
  ];

  test('returns one three-resource set per weakness and passes the avoid list', async () => {
    const fetcher = vi.fn().mockResolvedValue(stubResponse(JSON.stringify([three, three])));
    vi.stubGlobal('fetch', fetcher);

    const sets = await httpZaiClient(config).recommendResources(
      [request, request],
      ['[beginner] old'],
    );

    expect(sets).toEqual([three, three]);
    const body = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as { messages: { content: string }[] };
    expect(body.messages[0]!.content).toContain('[beginner] old');
    expect(body.messages[0]!.content).toContain('Hanging piece');
  });

  test('rejects a set with the wrong shape instead of storing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(stubResponse(JSON.stringify([three.slice(0, 2)]))),
    );
    await expect(httpZaiClient(config).recommendResources([request], [])).rejects.toThrow();
  });
});

describe('httpZaiClient.verifyResourceAssessment', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('parses the verdict object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(stubResponse('{"pass": true, "feedback": "Solid takeaway."}')),
    );
    await expect(
      httpZaiClient(config).verifyResourceAssessment({
        label: 'Hanging piece',
        resource: '[Beginner] Chess: 5334 Problems',
        summary: 'I drilled pins until spotting the loose piece became automatic.',
      }),
    ).resolves.toEqual({ pass: true, feedback: 'Solid takeaway.' });
  });
});

describe('model call budget', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('every call fits the platform budget with room for the database work', () => {
    // API Gateway kills the request at 30 seconds (infra/api.ts); a model
    // call that outlives the request is the 503 outage of 1 September.
    expect(CALL_TIMEOUT_MS).toBeLessThanOrEqual(25_000);
  });

  test('the fetch carries an abort signal, so a hung provider cannot hang the request', async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(stubResponse('ok'));
    });
    await httpZaiClient(config).summarizeReport({} as ReportSummaryFacts);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});
