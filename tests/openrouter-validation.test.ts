import { describe, expect, it } from 'vitest';
import {
  EvidenceMismatchError,
  validateCoachEvidence,
} from '../lib/openrouter';
import { buildCoachContext } from '../lib/coach-context';
import { SUMMARY_FIELDS } from '../lib/coach-context';
import type { DashboardData } from '../lib/hevy';
import type { AthleteProfile } from '../lib/storage';

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

const dashboard = {
  calendarWorkouts: [
    {
      id: 'workout-1',
      title: 'Upper',
      date: '2026-09-14',
      time: '10:00',
      durationMinutes: 60,
      workingSets: 4,
      volumeKg: 100,
      exercises: [
        {
          title: 'Bench Press',
          muscle: 'Chest',
          sets: [{ type: 'normal', weightKg: 50, reps: 8, rpe: 8 }],
        },
      ],
    },
  ],
} as DashboardData;

describe('coach evidence validation', () => {
  it('allows future planning years and bare unit explanations', () => {
    expect(() =>
      validateCoachEvidence(
        'By 2027 you could reasonably expect progress. Kilograms are what Hevy stores internally.',
        dashboard,
        profile,
      ),
    ).not.toThrow();
  });

  it('checks units only when a number is attached', () => {
    expect(() => validateCoachEvidence('Use 100 kg next session.', dashboard, profile)).toThrow(
      EvidenceMismatchError,
    );
  });

  it('distinguishes a recommendation from an unsupported historical claim', () => {
    expect(() => validateCoachEvidence('Consider adding the squat back.', dashboard, profile)).not.toThrow();
    expect(() => validateCoachEvidence('Your squat has stalled.', dashboard, profile)).toThrow(
      EvidenceMismatchError,
    );
  });

  it('rejects unsupported historical dates but accepts a verified citation', () => {
    expect(() => validateCoachEvidence('You logged a session on 2024-11-05.', dashboard, profile)).toThrow(
      EvidenceMismatchError,
    );
    expect(() =>
      validateCoachEvidence(
        '[Hevy: workout/workout-1 · 2026-09-14 · Bench Press]',
        dashboard,
        profile,
      ),
    ).not.toThrow();
  });

  it('grounds numeric claims in the injected evidence', () => {
    const evidence = JSON.stringify({ sessions: 4, workingSets: 18 });
    expect(() =>
      validateCoachEvidence('You logged 4 sessions and 18 working sets.', dashboard, profile, evidence),
    ).not.toThrow();
    expect(() =>
      validateCoachEvidence('You logged 99 sessions this month.', dashboard, profile, evidence),
    ).toThrow(EvidenceMismatchError);
  });

  it('uses the coach context summary fields as the citation allow-list', () => {
    for (const field of SUMMARY_FIELDS) {
      expect(() =>
        validateCoachEvidence(
          `Useful signal [Hevy summary: ${field}]`,
          dashboard,
          profile,
        ),
      ).not.toThrow();
    }
    expect(() =>
      validateCoachEvidence(
        'Old signal [Hevy summary: exerciseStats]',
        dashboard,
        profile,
      ),
    ).toThrow(EvidenceMismatchError);
    expect(() =>
      validateCoachEvidence(
        'Old signal [Hevy summary: primaryStrengthTrend]',
        dashboard,
        profile,
      ),
    ).toThrow(EvidenceMismatchError);
  });

  it('rejects an invented load while allowing small coaching counts', () => {
    const evidence = JSON.stringify({ load: '100 lb', reps: 8 });
    expect(() =>
      validateCoachEvidence(
        'Your bench is at 105 lb.',
        dashboard,
        profile,
        evidence,
      ),
    ).toThrow(EvidenceMismatchError);
    expect(() =>
      validateCoachEvidence(
        'Use 3 sets of 10 reps.',
        dashboard,
        profile,
        evidence,
      ),
    ).not.toThrow();
  });

  it('keeps chat context bounded while retrieving a referenced exercise', () => {
    const contextDashboard = {
      ...dashboard,
      progressionStates: [],
      muscles: [],
      adherenceWeeks: [],
      weeklyReview: { label: '', wins: [], watch: [], nextSteps: [] },
      weeklyReviewV2: null,
      reviewHistory: [],
      bodyWeightTrend: undefined,
      activeTrainingBlock: null,
    } as unknown as DashboardData;
    const context = buildCoachContext(
      profile,
      contextDashboard,
      [
        {
          id: 'message-1',
          conversationId: 'conversation-1',
          role: 'user',
          content: 'How is my bench progressing?',
          model: null,
          createdAt: '2026-09-15T12:00:00.000Z',
        },
      ],
    );
    expect(context.estimatedTokens).toBeLessThan(15_000);
    expect(JSON.parse(context.text).verifiedHevyWorkoutLog).toHaveLength(1);
  });
});
