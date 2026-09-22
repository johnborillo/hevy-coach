import { afterEach, describe, expect, it } from 'vitest';

import type { WeeklyReview } from '../lib/findings';
import {
  narrateReview,
  validateReviewNarrative,
} from '../lib/review-narrate';
import type { AthleteProfile } from '../lib/storage';

const previousKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
});

const profile = {
  weightUnit: 'lb',
  heightUnit: 'imperial',
} as AthleteProfile;

const review: WeeklyReview = {
  weekStart: '2026-09-14T04:00:00.000Z',
  generatedAt: '2026-09-22T12:00:00.000Z',
  summary: { sessions: 4, planned: 4, directSets: 18, prs: 1 },
  wins: [],
  watch: [],
  act: [
    {
      id: 'stalled:bench',
      kind: 'EXERCISE_STALLED',
      severity: 'act',
      subject: { type: 'exercise', key: 'bench', label: 'Bench Press' },
      headline: 'Bench Press has stalled across 4 comparable sessions.',
      evidence: { sessions: 4, modalLoadLb: 185 },
      recommendation: 'Hold the load and add a rep.',
      citations: [],
      firstSeenWeek: '2026-09-14T04:00:00.000Z',
    },
  ],
  carriedOver: [],
  narrative: null,
};

describe('weekly review narration', () => {
  it('silently skips generation when no API key is configured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(narrateReview(review, profile)).resolves.toBeNull();
  });

  it('skips filler when the review has no findings', async () => {
    process.env.OPENROUTER_API_KEY = 'unused';
    await expect(
      narrateReview(
        { ...review, wins: [], watch: [], act: [], carriedOver: [] },
        profile,
      ),
    ).resolves.toBeNull();
  });

  it('rejects invented figures and the wrong measurement unit', () => {
    expect(() =>
      validateReviewNarrative(
        'Bench Press is stalled at 185 lb across 4 sessions.',
        review,
        profile,
      ),
    ).not.toThrow();
    expect(() =>
      validateReviewNarrative(
        'Bench Press is stalled at 99 kg.',
        review,
        profile,
      ),
    ).toThrow();
    expect(() =>
      validateReviewNarrative(
        'Bench Press is stalled at 225 lb.',
        review,
        profile,
      ),
    ).toThrow();
  });
});
