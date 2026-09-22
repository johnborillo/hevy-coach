import { describe, expect, it } from 'vitest';

import { computeAdherence, computeBalance, computeMuscleAudit } from '../lib/audit';
import type { Muscle } from '../lib/muscles';

const now = new Date('2026-09-21T12:00:00.000Z');

describe('volume audit', () => {
  it('zero-fills muscles and tracks direct, indirect, and sessions hit', () => {
    const audit = computeMuscleAudit(
      [
        {
          workoutId: 'w1',
          performedAt: '2026-09-18T12:00:00.000Z',
          primary: 'chest_mid_lower',
          secondary: ['triceps'],
          countsAsWorking: 3,
        },
      ],
      now,
      7,
    );
    expect(audit.find((item) => item.muscle === 'chest_mid_lower')).toMatchObject({
      directSets: 3,
      sessionsHit: 1,
    });
    expect(audit.find((item) => item.muscle === 'triceps')).toMatchObject({
      directSets: 0,
      indirectSets: 1.5,
    });
    expect(audit.find((item) => item.muscle === 'calves')).toMatchObject({
      directSets: 0,
      bandLabel: 'zero',
    });
  });

  it('flags a strongly skewed push to pull ratio', () => {
    const base = (muscle: Muscle, sets: number) => ({
      muscle,
      name: muscle,
      directSets: sets,
      indirectSets: 0,
      sessionsHit: 2,
      previousDirectSets: sets,
      fourWeekAvgDirect: sets,
      bandLabel: 'moderate' as const,
    });
    const signals = computeBalance([
      base('chest_mid_lower', 40),
      base('lats', 10),
      base('upper_back', 0),
    ]);
    expect(signals.find((signal) => signal.key === 'push_pull')).toMatchObject({
      value: 4,
      status: 'watch',
    });
  });
});

describe('planned versus actual adherence', () => {
  it('caps above-plan weeks at 100 percent', () => {
    const weeks = computeAdherence(
      Array.from({ length: 4 }, (_, index) => ({
        id: `w-${index}`,
        performedAt: `2026-09-${14 + index}T12:00:00.000Z`,
      })),
      3,
      now,
    );
    expect(weeks.at(-2)).toMatchObject({
      actualSessions: 4,
      plannedSessions: 3,
      adherencePct: 100,
    });
  });
});
