import { describe, expect, it } from 'vitest';

import { buildCoachContext } from '../lib/coach-context';
import type { DashboardData } from '../lib/hevy';
import type { AthleteProfile } from '../lib/storage';

describe('coach prompt pipeline', () => {
  it('emits stable cache-friendly context keys before question-dependent retrieval', () => {
    const profile = {
      weightUnit: 'lb',
      heightUnit: 'imperial',
      phase: 'maintain',
      phaseStartedAt: '',
      primaryGoal: 'Strength',
      experience: 'intermediate',
      daysPerWeek: 4,
      minutesPerSession: 60,
      limitations: '',
      preferences: '',
    } as AthleteProfile;
    const dashboard = {
      calendarWorkouts: [],
      progressionStates: [],
      muscles: [],
      adherenceWeeks: [],
      weeklyReview: { label: '', wins: [], watch: [], nextSteps: [] },
      reviewHistory: [],
      bodyWeightTrend: undefined,
      activeTrainingBlock: null,
    } as unknown as DashboardData;
    const keys = Object.keys(JSON.parse(buildCoachContext(profile, dashboard, []).text));
    expect(keys.slice(0, 7)).toEqual([
      'athlete',
      'findings',
      'progression',
      'muscleAudit',
      'adherence',
      'workoutCoverage',
      'retrievalNote',
    ]);
    expect(keys.slice(-2)).toEqual(['verifiedHevyWorkoutLog', 'retrievedNotes']);
  });
});
