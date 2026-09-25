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
      'deepseek/deepseek-v4-flash-0731',
      'deepseek/deepseek-v4.1-flash',
      'openai/gpt-6-luna',
      'openai/gpt-oss-120b:free',
    ]);
    expect(isCoachModelId('openai/gpt-6-luna')).toBe(true);
    expect(isCoachModelId('unsupported/model')).toBe(false);
  });

  it('offers three distinct coaches', () => {
    expect(COACHES.map((coach) => coach.id)).toEqual([
      'rowan',
      'mira',
      'atlas',
    ]);
    expect(isCoachId('mira')).toBe(true);
    expect(isCoachId('unknown')).toBe(false);
  });

  it('round-trips coach and model metadata without a schema change', () => {
    const stored = encodeCoachMessageMetadata(
      'atlas',
      'deepseek/deepseek-v4.1-flash',
    );
    expect(decodeCoachMessageMetadata(stored)).toEqual({
      coachId: 'atlas',
      model: 'deepseek/deepseek-v4.1-flash',
    });
    expect(decodeCoachMessageMetadata('legacy-model')).toEqual({
      coachId: 'rowan',
      model: 'legacy-model',
    });
  });
});
