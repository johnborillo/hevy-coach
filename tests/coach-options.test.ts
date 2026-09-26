import { describe, expect, it } from 'vitest';

import {
  COACHES,
  COACH_MODELS,
  decodeCoachMessageMetadata,
  encodeCoachMessageMetadata,
  isCoachId,
  isCoachModelId,
} from '../lib/coach-options';

describe('coach options', () => {
  it('exposes only the supported OpenRouter models', () => {
    expect(COACH_MODELS.map((model) => model.id)).toEqual([
      'z-ai/glm-5.3-flash',
      'openai/gpt-6-luna',
      'deepseek/deepseek-v4.1-flash',
      'deepseek/deepseek-v4-flash-0731',
    ]);
    expect(isCoachModelId('openai/gpt-6-luna')).toBe(true);
    expect(isCoachModelId('deepseek/deepseek-v4.1-flash')).toBe(true);
    expect(isCoachModelId('unsupported/model')).toBe(false);
  });

  it('offers Rowan as the only coach for now', () => {
    expect(COACHES.map((coach) => coach.id)).toEqual([
      'rowan',
    ]);
    expect(isCoachId('rowan')).toBe(true);
    expect(isCoachId('mira')).toBe(false);
    expect(isCoachId('unknown')).toBe(false);
  });

  it('round-trips coach, model, and fallback metadata without a schema change', () => {
    const stored = encodeCoachMessageMetadata(
      'rowan',
      'openai/gpt-6-luna',
      'The selected model timed out after retrying.',
    );
    expect(decodeCoachMessageMetadata(stored)).toEqual({
      coachId: 'rowan',
      model: 'openai/gpt-6-luna',
      fallbackReason: 'The selected model timed out after retrying.',
    });
    expect(decodeCoachMessageMetadata('legacy-model')).toEqual({
      coachId: 'rowan',
      model: 'legacy-model',
      fallbackReason: null,
    });
  });
});
