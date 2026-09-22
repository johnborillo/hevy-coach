import { describe, expect, it } from 'vitest';
import { composeWeeklyReview, type FindingContext } from '../lib/findings';

function context(weekStart: string): FindingContext {
  return {
    weekStart,
    weekEnd: new Date(
      new Date(weekStart).getTime() + 7 * 86_400_000,
    ).toISOString(),
    summary: { sessions: 3, planned: 4, directSets: 42, prs: 0 },
    progressionStates: [
      {
        exerciseTemplateId: 'bench',
        slotId: null,
        title: 'Bench Press',
        variationChangeAt: null,
        sessionsAnalyzed: 6,
        lastPerformedAt: `${weekStart.slice(0, 10)}T12:00:00.000Z`,
        modalLoadKg: 80,
        repsAtModalLoad: [8, 8, 8],
        targetRepRange: [6, 10],
        rpeCoverage: 1,
        lastSetRpe: [9, 9.5, 9.5],
        rpeSlope: 0.3,
        performanceMetric: 'trend_e1rm',
        performanceIndex: [90, 90, 89, 88, 87, 86],
        performanceSlopePct: -1.5,
        sessionsSinceImprovement: 4,
        status: 'stalled',
        recommendation: 'reduce_load',
        rationale: 'Recent effort is high.',
      },
    ],
    records: [],
    muscles: [],
    balance: [],
    adherencePct: 75,
    plannedSessionsPerWeek: 4,
    sessionsInPriorWeek: 3,
    volumeChangePercent: 0,
    phase: 'maintain',
    activeBlockKind: null,
    citations: ['workout-1'],
  };
}

describe('weekly findings', () => {
  it('carries identical watch items forward and ages them', () => {
    const first = composeWeeklyReview(context('2026-09-07T00:00:00.000Z'));
    const second = composeWeeklyReview(
      context('2026-09-14T00:00:00.000Z'),
      first,
    );
    const third = composeWeeklyReview(
      context('2026-09-21T00:00:00.000Z'),
      second,
    );

    expect(first.wins).toHaveLength(0);
    expect(second.carriedOver[0]).toMatchObject({
      weeksOpen: 2,
      changed: 'unchanged',
    });
    expect(third.carriedOver[0]).toMatchObject({
      weeksOpen: 3,
      changed: 'unchanged',
    });
  });

  it('does not invent a PR win when no PR evidence exists', () => {
    const review = composeWeeklyReview(context('2026-09-07T00:00:00.000Z'));
    expect(review.wins.some((item) => item.kind === 'PR_ACHIEVED')).toBe(false);
  });
});
