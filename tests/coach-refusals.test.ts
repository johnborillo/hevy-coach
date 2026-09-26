import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  askCoach,
  detectRefusal,
  type CompletionPayload,
  type CoachAskTelemetry,
} from '../lib/openrouter';
import {
  decodeCoachMessageMetadata,
  encodeCoachMessageMetadata,
} from '../lib/coach-options';
import type { AthleteProfile, ChatMessage } from '../lib/storage';
import type { DashboardData } from '../lib/hevy';

vi.mock('../lib/notes-repo', () => ({
  searchStoredNotes: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/coach-context', () => ({
  SUMMARY_FIELDS: ['findings'],
  buildCoachContext: vi.fn(() => ({
    text: '{}',
    workoutIds: [],
    estimatedTokens: 1,
  })),
}));

const profile: AthleteProfile = {
  displayName: 'Athlete',
  biologicalSex: 'prefer_not_to_say',
  age: null,
  heightCm: null,
  weightKg: null,
  weightUnit: 'lb',
  heightUnit: 'imperial',
  experience: 'intermediate',
  primaryGoal: 'Build muscle',
  targetDate: '2027-01-01',
  daysPerWeek: 4,
  minutesPerSession: 60,
  equipment: 'Full gym',
  limitations: '',
  preferences: '',
  phase: 'maintain',
  phaseStartedAt: '',
  dailyCalories: null,
  proteinGrams: null,
  sleepHoursTypical: null,
  dropsetWeight: 0.5,
  loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
  timezone: 'UTC',
};

const dashboard = { calendarWorkouts: [] } as unknown as DashboardData;

function completion(
  content: string,
  model = 'openai/gpt-6-luna',
): CompletionPayload {
  return {
    id: `generation-${Math.random()}`,
    provider: 'test-provider',
    model,
    choices: [{ finish_reason: 'stop', message: { content } }],
  };
}

function refusalPayload(): CompletionPayload {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: "I'm sorry, but I cannot assist with that request.",
          refusal: 'safety refusal',
        },
      },
    ],
  };
}

function history(...messages: Partial<ChatMessage>[]): ChatMessage[] {
  return messages.map((message, index) => ({
    id: message.id ?? `message-${index}`,
    conversationId: 'conversation-1',
    role: message.role ?? 'user',
    content: message.content ?? '',
    model: message.model ?? null,
    createdAt: message.createdAt ?? `2026-09-2${index}T12:00:00.000Z`,
    ...message,
  })) as ChatMessage[];
}

describe('refusal detection', () => {
  it('detects refusal fields, content filters, and short refusal text', () => {
    expect(detectRefusal(refusalPayload(), 'A short answer')).toBe(
      'refusal_field',
    );
    expect(
      detectRefusal(
        { choices: [{ finish_reason: 'content_filter' }] },
        'A short answer',
      ),
    ).toBe('content_filter');
    expect(
      detectRefusal(null, "I'm sorry, but I cannot assist with that request."),
    ).toBe('refusal_text');
  });

  it('does not flag verification language or long coaching answers', () => {
    expect(
      detectRefusal(null, "I can't verify that from the available Hevy log."),
    ).toBeNull();
    expect(
      detectRefusal(
        null,
        `Sorry to hear about your elbow. ${'Keep training safely. '.repeat(20)}`,
      ),
    ).toBeNull();
  });
});

describe('coach refusal recovery', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  it('retries the requested model once and keeps it when it recovers', async () => {
    const responses = [refusalPayload(), completion('Keep the current plan.')];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(responses.shift()), { status: 200 }),
      );
    const result = await askCoach(
      'user-1',
      profile,
      dashboard,
      history({ role: 'user', content: 'What should I do?' }),
      { model: 'openai/gpt-6-luna' },
    );

    expect(result?.model).toBe('openai/gpt-6-luna');
    expect(result?.flags?.notice).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the alternate model after two refusals and records a notice', async () => {
    const responses = [
      refusalPayload(),
      refusalPayload(),
      completion('Here is a grounded answer.', 'z-ai/glm-5.3-flash'),
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(responses.shift()), { status: 200 }),
    );
    const result = await askCoach(
      'user-1',
      profile,
      dashboard,
      history({ role: 'user', content: 'What should I do?' }),
      { model: 'openai/gpt-6-luna' },
    );

    expect(result?.model).toBe('z-ai/glm-5.3-flash');
    expect(result?.flags?.requestedModel).toBe('openai/gpt-6-luna');
    expect(result?.flags?.notice).toBe(
      'Answered by GLM 5.3 Flash because GPT-6 Luna declined this question.',
    );
  });

  it('returns the evidence fallback signal after three refusals', async () => {
    const responses = [refusalPayload(), refusalPayload(), refusalPayload()];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(responses.shift()), { status: 200 }),
    );
    const telemetry: CoachAskTelemetry = {
      passes: 0,
      completions: [],
      validationOutcome: 'n/a',
      validationFailureReasons: [],
      issues: [],
      refusalDetected: false,
      refusalReason: null,
      refusalRetries: 0,
    };
    const result = await askCoach(
      'user-1',
      profile,
      dashboard,
      history({ role: 'user', content: 'What should I do?' }),
      { model: 'openai/gpt-6-luna', telemetry },
    );

    expect(result).toBeNull();
    expect(telemetry.fallbackReason).toBe(
      'The AI model declined to answer this question.',
    );
    expect(telemetry.refusalRetries).toBe(2);
  });
});

describe('coach message metadata and history hygiene', () => {
  it('round-trips four-segment flags and preserves legacy metadata', () => {
    const flags = {
      v: 1 as const,
      refusal: true,
      requestedModel: 'openai/gpt-6-luna',
      notice: 'Answered by GLM 5.3 Flash.',
      passes: 2,
    };
    const encoded = encodeCoachMessageMetadata(
      'rowan',
      'z-ai/glm-5.3-flash',
      'The provider declined the request.',
      flags,
    );
    expect(decodeCoachMessageMetadata(encoded)).toEqual({
      coachId: 'rowan',
      model: 'z-ai/glm-5.3-flash',
      fallbackReason: 'The provider declined the request.',
      flags,
    });
    expect(
      decodeCoachMessageMetadata('@hevy-coach:rowan|model|reason'),
    ).toEqual({
      coachId: 'rowan',
      model: 'model',
      fallbackReason: 'reason',
    });
    expect(decodeCoachMessageMetadata('@hevy-coach:rowan|model')).toEqual({
      coachId: 'rowan',
      model: 'model',
      fallbackReason: null,
    });
    expect(decodeCoachMessageMetadata('legacy-model')).toEqual({
      coachId: 'rowan',
      model: 'legacy-model',
      fallbackReason: null,
    });
  });

  it('excludes refusals and strips legacy verification footers from history', async () => {
    const responses = [completion('Fresh answer.')];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(responses.shift()), { status: 200 }),
      );
    await askCoach(
      'user-1',
      profile,
      dashboard,
      history(
        { role: 'user', content: 'Old question' },
        {
          role: 'assistant',
          content: "I'm sorry, but I cannot assist with that request.",
        },
        {
          role: 'assistant',
          content:
            'Old answer.\n\n*Some figures in this answer could not be verified against your synchronized Hevy log.*',
        },
        { role: 'user', content: 'New question' },
      ),
      { model: 'openai/gpt-6-luna' },
    );
    const rawBody = fetchMock.mock.calls[0]?.[1]?.body;
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '');
    const messages = body.messages as Array<{ content: string }>;
    expect(
      messages.some((message) => message.content.includes('cannot assist')),
    ).toBe(false);
    expect(
      messages.some((message) => message.content.includes('Some figures')),
    ).toBe(false);
    expect(
      messages.some((message) => message.content.includes('Old answer.')),
    ).toBe(true);
  });
});
