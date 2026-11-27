import { describe, expect, it } from 'vitest';

import { buildCoachContext } from '../lib/coach-context';
import {
  blockProgress,
  compareSession,
  muscleRecency,
  nextProgramDayIndex,
  plannedSession,
  weekProgress,
} from '../lib/coach-insights';
import { collectEvidenceIssues } from '../lib/openrouter';
import type { CalendarWorkout, DashboardData } from '../lib/hevy';
import type { NextSession } from '../lib/program-next';
import type {
  AthleteProfile,
  ChatMessage,
  TrainingProgram,
} from '../lib/storage';

// 2026-11-26 is a Thursday.
const TODAY = '2026-11-26';
const NOW = new Date('2026-11-26T20:00:00.000Z');

const profile = {
  displayName: 'Athlete',
  weightUnit: 'kg',
  heightUnit: 'metric',
  heightCm: null,
  weightKg: null,
  phase: 'maintain',
  phaseStartedAt: '',
  primaryGoal: 'Strength',
  experience: 'intermediate',
  daysPerWeek: 4,
  minutesPerSession: 60,
  limitations: '',
  preferences: '',
  timezone: 'UTC',
} as unknown as AthleteProfile;

type SetSpec = [weightKg: number | null, reps: number, type?: string];

function workout(
  id: string,
  date: string,
  title: string,
  exercises: Record<string, { muscle: string; sets: SetSpec[] }>,
): CalendarWorkout {
  return {
    id,
    title,
    date,
    time: '18:00',
    durationMinutes: 60,
    workingSets: Object.values(exercises).reduce(
      (total, item) => total + item.sets.filter(([, , type]) => type !== 'warmup').length,
      0,
    ),
    volumeKg: 4000,
    exercises: Object.entries(exercises).map(([exerciseTitle, item]) => ({
      title: exerciseTitle,
      muscle: item.muscle,
      sets: item.sets.map(([weightKg, reps, type]) => ({
        type: type ?? 'normal',
        weightKg,
        reps,
        rpe: 8,
      })),
    })),
  } as unknown as CalendarWorkout;
}

// Newest first, like dashboard.calendarWorkouts.
const workouts = [
  workout('w-push-today', '2026-11-26', 'Push A', {
    'Bench Press (Barbell)': {
      muscle: 'Chest',
      sets: [[60, 8, 'warmup'], [102.5, 5], [100, 5]],
    },
    'Lateral Raise (Dumbbell)': { muscle: 'Shoulders', sets: [[10, 15], [10, 14]] },
  }),
  workout('w-legs', '2026-11-24', 'Legs', {
    'Squat (Barbell)': { muscle: 'Quadriceps', sets: [[140, 5], [140, 5]] },
  }),
  workout('w-upper', '2026-11-22', 'Upper', {
    'Bench Press (Barbell)': { muscle: 'Chest', sets: [[100, 6]] },
  }),
  workout('w-push-prev', '2026-11-19', 'Push A', {
    'Bench Press (Barbell)': { muscle: 'Chest', sets: [[100, 5], [100, 5]] },
    'Lateral Raise (Dumbbell)': { muscle: 'Shoulders', sets: [[10, 12]] },
  }),
];

const records = [
  {
    exercise: 'Bench Press (Barbell)',
    date: '2026-11-26',
    valueKg: 115,
    reps: 5,
    weightKg: 102.5,
    kind: 'load_at_reps' as const,
    previousValue: 100,
    previousDate: '2026-11-19',
    scope: 'exercise',
  },
] as unknown as DashboardData['records'];

const program = {
  id: 'p1',
  schemaVersion: 2,
  title: 'Upper Lower',
  goal: 'Strength',
  durationWeeks: 6,
  daysPerWeek: 3,
  minutesPerSession: 60,
  overview: '',
  progression: '',
  deload: '',
  createdAt: '2026-11-01',
  days: [
    { day: 1, title: 'Push A', focus: 'Chest and shoulders', exercises: [] },
    { day: 2, title: 'Pull A', focus: 'Back', exercises: [] },
    { day: 3, title: 'Legs', focus: 'Lower body', exercises: [] },
  ],
} as unknown as TrainingProgram;

describe('session comparison', () => {
  it('compares with the previous same-named workout and each exercise\'s last occurrence', () => {
    const comparison = compareSession(workouts[0], workouts, records, profile);
    expect(comparison.previousSameNamedWorkout).toMatchObject({
      workoutId: 'w-push-prev',
      date: '2026-11-19',
      daysEarlier: 7,
    });
    const bench = comparison.exercises[0];
    // Bench last appeared in "Upper", not in the previous "Push A".
    expect(bench.previous).toMatchObject({ workoutId: 'w-upper', date: '2026-11-22' });
    // The warm-up set is ignored.
    expect(bench.thisSession).toMatchObject({
      workingSets: 2,
      topSet: { load: '102.5 kg', reps: 5 },
    });
    expect(bench.topSetChange).toEqual({ load: '2.5 kg', reps: -1 });
    expect(comparison.exercises[1].previous).toMatchObject({ workoutId: 'w-push-prev' });
    expect(comparison.personalRecords).toEqual([
      expect.objectContaining({ exercise: 'Bench Press (Barbell)', load: '102.5 kg', reps: 5 }),
    ]);
  });

  it('handles a first-ever session', () => {
    const comparison = compareSession(workouts[3], workouts, [], profile);
    expect(comparison.previousSameNamedWorkout).toBeNull();
    expect(comparison.exercises[0].previous).toBeNull();
    expect(comparison.exercises[0].topSetChange).toBeNull();
  });
});

describe('training status', () => {
  it('reports days since each muscle was trained and its weekly working sets', () => {
    expect(muscleRecency(workouts, TODAY)).toEqual([
      { muscle: 'Chest', lastTrained: '2026-11-26', daysSince: 0, workingSetsLast7Days: 3 },
      { muscle: 'Shoulders', lastTrained: '2026-11-26', daysSince: 0, workingSetsLast7Days: 2 },
      { muscle: 'Quadriceps', lastTrained: '2026-11-24', daysSince: 2, workingSetsLast7Days: 2 },
    ]);
  });

  it('counts this Monday-based week against the target', () => {
    expect(weekProgress(workouts, TODAY, 4)).toMatchObject({
      weekStart: '2026-11-23',
      sessionsDone: 2,
      targetSessions: 4,
      sessionsRemaining: 2,
      daysLeftIncludingToday: 4,
      sessions: [
        { workoutId: 'w-legs', weekday: 'Tuesday' },
        { workoutId: 'w-push-today', weekday: 'Thursday' },
      ],
    });
  });

  it('picks the program day after the latest matching workout', () => {
    expect(nextProgramDayIndex(program, workouts)).toBe(1); // after Push A → Pull A
    expect(nextProgramDayIndex(program, workouts.slice(1))).toBe(0); // after Legs → wraps
    expect(nextProgramDayIndex(program, [])).toBe(0);
  });

  it('summarizes the next planned session', () => {
    const session = {
      dayIndex: 1,
      day: program.days[1],
      exercises: [
        { name: 'Row', sets: 3, reps: '8–10', effort: 'RPE 8', load: '70 kg' },
      ],
    } as unknown as NextSession;
    expect(plannedSession(program, session)).toEqual({
      program: 'Upper Lower',
      day: 2,
      of: 3,
      title: 'Pull A',
      focus: 'Back',
      exercises: [{ name: 'Row', sets: 3, reps: '8–10', effort: 'RPE 8', load: '70 kg' }],
    });
    expect(plannedSession(null, session)).toBeNull();
  });

  it('places today inside the active training block', () => {
    expect(
      blockProgress(
        {
          id: 'b1',
          userId: 'u1',
          name: 'Strength block',
          kind: 'intensification',
          startsAt: '2026-11-09',
          endsAt: '2026-11-29',
          programId: null,
        },
        TODAY,
      ),
    ).toEqual({
      name: 'Strength block',
      kind: 'intensification',
      startsAt: '2026-11-09',
      endsAt: '2026-11-29',
      started: true,
      week: 3,
      totalWeeks: 3,
      daysRemaining: 3,
      endsWithinAWeek: true,
    });
    expect(blockProgress(null, TODAY)).toBeNull();
  });
});

describe('coach context with insights', () => {
  const dashboard = {
    calendarWorkouts: workouts,
    records,
    progressionStates: [],
    muscles: [],
    adherenceWeeks: [],
    weeklyReview: { label: '', wins: [], watch: [], nextSteps: [] },
    activeTrainingBlock: null,
  } as unknown as DashboardData;
  const question = (content: string) =>
    [
      {
        id: 'm1',
        conversationId: 'c1',
        role: 'user',
        content,
        model: null,
        createdAt: NOW.toISOString(),
      },
    ] as ChatMessage[];

  it('adds the comparison and the earlier workouts it cites for "how was today?"', () => {
    const built = buildCoachContext(profile, dashboard, question('How was my workout today?'), {
      now: NOW,
    });
    const context = JSON.parse(built.text);
    expect(context.sessionComparisons).toHaveLength(1);
    expect(context.sessionComparisons[0].workoutId).toBe('w-push-today');
    expect(built.workoutIds).toEqual(
      expect.arrayContaining(['w-push-today', 'w-upper', 'w-push-prev']),
    );
    expect(context.trainingStatus.thisWeek.sessionsDone).toBe(2);
    expect(context.trainingStatus.muscleRecency[0].muscle).toBe('Chest');
    expect(context.trainingStatus.nextPlannedSession).toBeNull();

    const answer =
      'Bench Press (Barbell) topped out at 102.5 kg for 5 reps, up 2.5 kg from 2026-11-22 [Hevy: workout/w-upper · 2026-11-22 · Bench Press (Barbell)].';
    expect(collectEvidenceIssues(answer, dashboard, profile, built.text)).toEqual([]);
  });

  it('skips comparisons for questions that are not about a specific session', () => {
    const context = JSON.parse(
      buildCoachContext(profile, dashboard, question('Why is my bench stalling?'), {
        now: NOW,
      }).text,
    );
    expect(context.sessionComparisons).toEqual([]);
  });
});
