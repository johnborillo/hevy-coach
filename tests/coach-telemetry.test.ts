import { describe, expect, it } from 'vitest';

import { summarizeCompletion, type CompletionPayload } from '../lib/openrouter';
import { TurnTimer } from '../lib/coach-telemetry';

describe('completion telemetry', () => {
  it('summarizes a full OpenRouter completion payload', () => {
    const payload: CompletionPayload = {
      id: 'gen-123',
      provider: 'openai',
      model: 'openai/gpt-6-luna',
      choices: [
        {
          finish_reason: 'stop',
          native_finish_reason: 'completed',
          message: { content: 'Done', refusal: null },
        },
      ],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 240,
        total_tokens: 1440,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens_details: { reasoning_tokens: 64 },
        cost: 0.0123,
      },
    };

    expect(summarizeCompletion(payload)).toEqual({
      generationId: 'gen-123',
      provider: 'openai',
      finishReason: 'stop',
      nativeFinishReason: 'completed',
      hasRefusalField: true,
      promptTokens: 1200,
      cachedTokens: 800,
      completionTokens: 240,
      reasoningTokens: 64,
      cost: 0.0123,
    });
  });

  it('tolerates a minimal payload', () => {
    expect(summarizeCompletion({})).toEqual({
      generationId: null,
      provider: null,
      finishReason: null,
      nativeFinishReason: null,
      hasRefusalField: false,
      promptTokens: null,
      cachedTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      cost: null,
    });
  });

  it('records that a refusal field was present', () => {
    expect(
      summarizeCompletion({
        choices: [{ message: { refusal: 'I cannot help with that.' } }],
      }).hasRefusalField,
    ).toBe(true);
  });
});

describe('TurnTimer', () => {
  it('records named phases and serializes timings', () => {
    let now = 100;
    const timer = new TurnTimer(() => now);

    timer.start('authz');
    now += 12;
    timer.end('authz');
    timer.start('loadData');
    now += 8;
    timer.end('loadData');

    expect(timer.serialize()).toEqual({
      phases: { authz: 12, loadData: 8 },
      totalMs: 20,
    });
    expect(timer.serverTiming()).toBe(
      'authz;dur=12, loadData;dur=8, total;dur=20',
    );
  });
});
