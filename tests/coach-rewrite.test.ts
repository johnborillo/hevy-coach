import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  askCoach,
  COACH_TURN_BUDGET_MS,
  isTimeoutError,
  type CompletionPayload,
} from '../lib/openrouter';
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

const profile = {
  displayName: 'Athlete',
  weightUnit: 'lb',
  heightUnit: 'imperial',
  timezone: 'UTC',
} as unknown as AthleteProfile;

const dashboard = { calendarWorkouts: [] } as unknown as DashboardData;

const history: ChatMessage[] = [
  {
    id: 'message-1',
    conversationId: 'conversation-1',
    role: 'user',
    content: 'How is my bench going?',
    model: null,
    createdAt: '2026-11-16T12:00:00.000Z',
  } as ChatMessage,
];

// The validator rejects this date (hard issue) and this count (soft issue).
const HARD_DRAFT = 'On 2026-11-10 you benched 225 lb for 5 reps.';
const SOFT_DRAFT = 'You have trained 37 times this year. Keep the current plan.';
const CLEAN_DRAFT = 'Keep the current plan and add a rep next session.';

function completion(content: string): CompletionPayload {
  return {
    id: `generation-${Math.random()}`,
    provider: 'test-provider',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    choices: [{ finish_reason: 'stop', message: { content } }],
  };
}

function jsonResponse(content: string) {
  return new Response(JSON.stringify(completion(content)), { status: 200 });
}

function streamResponse(content: string) {
  const words = content.split(/(?<= )/);
  const body = [
    ...words.map(
      (word) =>
        `data: ${JSON.stringify({ id: 'gen', choices: [{ delta: { content: word } }] })}\n\n`,
    ),
    `data: ${JSON.stringify({ id: 'gen', model: 'deepseek/deepseek-v4.1-flash-1017', choices: [{ finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function timeoutError() {
  return new DOMException(
    'The operation was aborted due to timeout',
    'TimeoutError',
  );
}

function recordStream() {
  const events: Array<[string, string?]> = [];
  return {
    events,
    visibleText: () =>
      events
        .filter(([type]) => type === 'delta')
        .map(([, text]) => text)
        .join(''),
    stream: {
      onDelta: (text: string) => events.push(['delta', text]),
      onStatus: (state: string) => events.push(['status', state]),
      onReset: () => events.push(['reset']),
    },
  };
}

describe('coach evidence rewrite', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  it('recognizes AbortSignal timeouts', () => {
    expect(isTimeoutError(timeoutError())).toBe(true);
    expect(isTimeoutError(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isTimeoutError(new Error('boom'))).toBe(false);
  });

  it('keeps the first draft when the rewrite times out instead of throwing', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(HARD_DRAFT))
      .mockRejectedValue(timeoutError());
    const result = await askCoach('user-1', profile, dashboard, history, {
      model: 'deepseek/deepseek-v4.1-flash-1017',
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(result?.content).toBe(HARD_DRAFT);
    expect(result?.model).toBe('deepseek/deepseek-v4.1-flash-1017');
    expect(result?.flags?.validation).toBe('unverified');
    expect(result?.telemetry.validationOutcome).toBe('unverified');
  });

  it('does not rewrite a draft that only has soft issues', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(SOFT_DRAFT));
    const result = await askCoach('user-1', profile, dashboard, history, {
      model: 'deepseek/deepseek-v4.1-flash-1017',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.content).toBe(SOFT_DRAFT);
    expect(result?.flags?.validation).toBe('unverified');
  });

  it('skips the rewrite when the turn budget cannot fit one', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(HARD_DRAFT));
    const result = await askCoach('user-1', profile, dashboard, history, {
      model: 'deepseek/deepseek-v4.1-flash-1017',
      budgetStartedAt: Date.now() - (COACH_TURN_BUDGET_MS - 10_000),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.content).toBe(HARD_DRAFT);
  });

  it('keeps the first draft on screen and rewrites it hidden while streaming', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(streamResponse(HARD_DRAFT))
      .mockResolvedValueOnce(streamResponse(CLEAN_DRAFT));
    const recorder = recordStream();
    const result = await askCoach('user-1', profile, dashboard, history, {
      model: 'deepseek/deepseek-v4.1-flash-1017',
      budgetStartedAt: Date.now(),
      stream: recorder.stream,
    });
    expect(recorder.events).not.toContainEqual(['reset']);
    expect(recorder.events).toContainEqual(['status', 'double_checking']);
    // Only the first draft streamed visibly; the rewrite arrives with "done".
    expect(recorder.visibleText()).toBe(HARD_DRAFT);
    expect(result?.content).toBe(CLEAN_DRAFT);
    expect(result?.flags?.validation).toBe('passed_after_retry');
  });

  it('falls back to the visible draft when a streamed rewrite times out', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(streamResponse(HARD_DRAFT))
      .mockRejectedValue(timeoutError());
    const recorder = recordStream();
    const result = await askCoach('user-1', profile, dashboard, history, {
      model: 'deepseek/deepseek-v4.1-flash-1017',
      budgetStartedAt: Date.now(),
      stream: recorder.stream,
    });
    expect(recorder.events).not.toContainEqual(['reset']);
    expect(result?.content).toBe(HARD_DRAFT);
    expect(result?.flags?.validation).toBe('unverified');
  });
});
