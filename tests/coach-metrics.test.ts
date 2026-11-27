import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aggregateMetrics,
  buildTurnMetric,
  classifyQuestion,
  estimatePrompt,
  metricsToCsv,
  type CoachTurnMetric,
} from '../lib/coach-metrics';
import {
  askCoach,
  createCoachAskTelemetry,
  type CoachAskTelemetry,
} from '../lib/openrouter';
import type { AthleteProfile, ChatMessage } from '../lib/storage';
import type { DashboardData } from '../lib/hevy';

vi.mock('../lib/notes-repo', () => ({
  searchStoredNotes: vi.fn().mockResolvedValue([]),
}));

const TODAY = '2026-11-26';

describe('prompt estimate', () => {
  it('splits the prompt into system, context sections, framing and history', () => {
    const contextJson = JSON.stringify({ athlete: { goal: 'x'.repeat(78) }, clock: { today: TODAY } });
    const estimate = estimatePrompt({
      systemPrompt: 'a'.repeat(400),
      contextMessage: `Current private training context:\n${contextJson}`,
      contextJson,
      history: [{ content: 'b'.repeat(40) }, { content: 'c'.repeat(80) }],
    });
    expect(estimate.historyMessages).toBe(2);
    expect(estimate.sections.systemPrompt).toBe(100);
    expect(estimate.sections['context.athlete']).toBe(23);
    expect(estimate.sections['context.clock']).toBe(6);
    expect(estimate.sections.history).toBe(30);
    expect(estimate.sections['context.framing']).toBeGreaterThan(0);
    expect(estimate.estimatedTokens).toBe(
      Object.values(estimate.sections).reduce((a, b) => a + b, 0),
    );
  });
});

describe('question kinds', () => {
  it.each([
    ['How was my workout today?', 'session_review'],
    ['how did last Monday go', 'session_review'],
    ['Should I train legs today or rest?', 'readiness'],
    ['What should I do today?', 'planning'],
    ['Why is my bench stalling?', 'progress'],
    ['What did I do on 2026-11-20?', 'date_specific'],
    ['Is creatine worth it?', 'general'],
  ])('%s → %s', (question, kind) => {
    expect(classifyQuestion(question, TODAY)).toBe(kind);
  });
});

function telemetry(overrides: Partial<CoachAskTelemetry> = {}): CoachAskTelemetry {
  return {
    ...createCoachAskTelemetry(),
    passes: 2,
    completions: [
      {
        pass: 0,
        kind: 'primary',
        model: 'z-ai/glm-5.3-flash',
        completion: {
          generationId: 'g1',
          provider: 'p',
          finishReason: 'stop',
          nativeFinishReason: 'stop',
          hasRefusalField: false,
          promptTokens: 6000,
          cachedTokens: 4000,
          completionTokens: 500,
          reasoningTokens: 200,
          cost: 0.002,
          attempts: 1,
          durationMs: 9000,
        },
      },
      {
        pass: 1,
        kind: 'primary',
        model: 'z-ai/glm-5.3-flash',
        completion: {
          generationId: 'g2',
          provider: 'p',
          finishReason: 'stop',
          nativeFinishReason: 'stop',
          hasRefusalField: false,
          promptTokens: 6100,
          cachedTokens: 0,
          completionTokens: 450,
          reasoningTokens: null,
          cost: 0.003,
          attempts: 1,
          durationMs: 8000,
        },
      },
    ],
    promptEstimate: {
      estimatedTokens: 5000,
      historyMessages: 3,
      sections: { systemPrompt: 1000, 'context.trainingStatus': 1500, history: 2500 },
    },
    ...overrides,
  };
}

function metric(overrides: Partial<Parameters<typeof buildTurnMetric>[0]> = {}) {
  return buildTurnMetric({
    id: crypto.randomUUID(),
    userId: 'u1',
    conversationId: 'conv-a',
    messageId: 'm1',
    createdAt: '2026-11-26T12:00:00.000Z',
    question: 'How was my workout today?',
    today: TODAY,
    requestedModel: 'z-ai/glm-5.3-flash',
    servedModel: 'z-ai/glm-5.3-flash',
    telemetry: telemetry(),
    totalMs: 18000,
    ...overrides,
  });
}

describe('turn metric', () => {
  it('sums every request in the turn and keeps the first-pass prompt size', () => {
    const row = metric();
    expect(row).toMatchObject({
      questionKind: 'session_review',
      outcome: 'ai',
      passes: 2,
      requests: 2,
      historyMessages: 3,
      estimatedPromptTokens: 5000,
      firstPassPromptTokens: 6000,
      promptTokens: 12100,
      cachedTokens: 4000,
      completionTokens: 950,
      reasoningTokens: 200,
      cost: 0.005,
    });
    expect(row.completions).toHaveLength(2);
  });

  it('records evidence-engine turns with no model usage', () => {
    const row = metric({
      servedModel: 'evidence-engine',
      telemetry: { ...createCoachAskTelemetry(), passes: 1 },
    });
    expect(row).toMatchObject({
      outcome: 'evidence-engine',
      requests: 0,
      promptTokens: null,
      cost: null,
      sections: {},
    });
  });
});

describe('aggregation', () => {
  const rows: CoachTurnMetric[] = [
    metric({ conversationId: 'conv-b', createdAt: '2026-11-26T13:00:00.000Z' }),
    metric({
      createdAt: '2026-11-26T12:30:00.000Z',
      question: 'Is creatine worth it?',
      telemetry: telemetry({
        completions: telemetry().completions.slice(0, 1).map((item) => ({
          ...item,
          completion: item.completion && { ...item.completion, promptTokens: 8000, cachedTokens: 6000 },
        })),
        promptEstimate: {
          estimatedTokens: 6400,
          historyMessages: 9,
          sections: { systemPrompt: 1000, 'context.trainingStatus': 1400, history: 4000 },
        },
      }),
    }),
    metric({ createdAt: '2026-11-26T12:00:00.000Z' }),
  ];

  it('reports totals, cache rate, calibrated sections and growth per conversation', () => {
    const report = aggregateMetrics(rows);
    expect(report.turns).toBe(3);
    expect(report.overall.maxPromptTokens).toBe(8000);
    expect(report.overall.cacheHitRate).toBeCloseTo(14000 / 32200, 3);
    expect(report.overall.estimateCalibration).toBeCloseTo((1.2 + 1.25 + 1.2) / 3, 3);
    expect(report.sections[0].section).toBe('history');
    expect(report.sections.reduce((total, item) => total + (item.share ?? 0), 0)).toBeCloseTo(1, 2);
    const conversation = report.byConversation.find((item) => item.conversationId === 'conv-a');
    expect(conversation).toMatchObject({
      turns: 2,
      firstTurnPromptTokens: 6000,
      lastTurnPromptTokens: 8000,
      maxHistoryMessages: 9,
    });
    expect(report.byQuestionKind.map((item) => item.questionKind).sort()).toEqual([
      'general',
      'session_review',
    ]);
    expect(report.byHistoryLength.map((item) => item.historyMessages)).toEqual(['2-4', '9-12']);
  });

  it('exports one CSV row per turn with a column per section', () => {
    const csv = metricsToCsv(rows).split('\n');
    expect(csv).toHaveLength(4);
    expect(csv[0]).toContain('firstPassPromptTokens');
    expect(csv[0]).toContain('section:context.trainingStatus');
    expect(csv[1]).not.toMatch(/How was my workout/);
  });

  it('handles an empty history', () => {
    expect(aggregateMetrics([])).toMatchObject({ turns: 0, sections: [], byConversation: [] });
  });
});

describe('askCoach prompt estimate', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  it('records a per-section estimate of the first pass', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'g',
          model: 'z-ai/glm-5.3-flash',
          choices: [{ finish_reason: 'stop', message: { content: 'Keep the plan.' } }],
          usage: { prompt_tokens: 3000, completion_tokens: 10 },
        }),
        { status: 200 },
      ),
    );
    const profile = { weightUnit: 'kg', heightUnit: 'metric', timezone: 'UTC' } as AthleteProfile;
    const dashboard = {
      calendarWorkouts: [],
      progressionStates: [],
      muscles: [],
      adherenceWeeks: [],
      weeklyReview: { label: '', wins: [], watch: [], nextSteps: [] },
    } as unknown as DashboardData;
    const history = [
      { id: '1', conversationId: 'c', role: 'user', content: 'Hello coach', model: null, createdAt: '' },
    ] as ChatMessage[];
    const result = await askCoach('u1', profile, dashboard, history, {
      model: 'z-ai/glm-5.3-flash',
    });
    const estimate = result?.telemetry.promptEstimate;
    expect(estimate?.historyMessages).toBe(1);
    expect(estimate?.sections.systemPrompt).toBeGreaterThan(500);
    expect(estimate?.sections['context.trainingStatus']).toBeGreaterThan(0);
    expect(estimate?.sections['context.verifiedHevyWorkoutLog']).toBeGreaterThan(0);
  });
});
