import { describe, expect, it } from 'vitest';

import { snapshotContent, stableFingerprint } from '../lib/analysis-cache';
import type { DashboardData } from '../lib/hevy';

describe('analysis snapshots', () => {
  it('uses a repeatable fingerprint that changes with its inputs', () => {
    const input = { workouts: 12, profile: { daysPerWeek: 4 } };

    expect(stableFingerprint(input)).toBe(stableFingerprint(input));
    expect(stableFingerprint(input)).not.toBe(
      stableFingerprint({ workouts: 13, profile: { daysPerWeek: 4 } }),
    );
  });

  it('keeps the dashboard summary but omits the large calendar payload', () => {
    const dashboard = {
      analysis: {
        version: 6,
        generatedAt: '2026-09-22T12:00:00.000Z',
        coverage: {
          workoutCount: 1,
          setCount: 1,
          templateCount: 1,
          oldestWorkoutAt: '2026-09-20T12:00:00.000Z',
          newestWorkoutAt: '2026-09-20T12:00:00.000Z',
        },
      },
      calendarWorkouts: [{ id: 'workout-1' }],
      stats: { sessions30d: 1 },
    } as unknown as DashboardData;

    const snapshot = snapshotContent(dashboard);

    expect(snapshot.calendarWorkouts).toEqual([]);
    expect(snapshot.analysis.coverage.workoutCount).toBe(1);
    expect(dashboard.calendarWorkouts).toHaveLength(1);
  });
});
