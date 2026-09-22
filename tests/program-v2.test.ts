import { afterEach, describe, expect, it } from 'vitest';
import { buildRoutinePayload, createConfirmationToken, verifyConfirmationToken } from '../lib/hevy-write';
import { resolveNextSession } from '../lib/program-next';
import {
  normalizeProgramV2,
  validateProgramV2,
} from '../lib/program-v2';
import type { DashboardData } from '../lib/hevy';
import type { AthleteProfile, TrainingProgram } from '../lib/storage';

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
  targetDate: '',
  daysPerWeek: 2,
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
  exerciseStats: [
    {
      exerciseTemplateId: 'bench-template',
      slotId: 'bench-slot',
      slotName: 'Bench',
      exercise: 'Bench Press',
      muscle: 'Chest',
      sessions: 8,
      workingSets: 24,
      volumeKg: 1000,
      bestE1rmKg: 80,
      change: 3,
      progressionStatus: 'progressing',
      progressionRecommendation: 'add_load',
      progressionRationale: 'Good trend',
      modalLoadKg: 70,
      targetRepRange: [8, 12],
      repsAtModalLoad: [12, 12, 12],
      lastSetRpe: [8, 8],
    },
  ],
  progressionStates: [],
} as unknown as DashboardData;

const program: TrainingProgram = {
  id: 'program-1',
  schemaVersion: 2,
  title: 'Test block',
  goal: 'Build muscle',
  durationWeeks: 8,
  daysPerWeek: 2,
  minutesPerSession: 60,
  overview: 'A test block.',
  progression: 'Add load after the top of the range.',
  deload: 'Reduce sets in week 8.',
  createdAt: '2026-09-20T00:00:00.000Z',
  days: [
    {
      day: 1,
      title: 'Upper A',
      focus: 'Chest',
      exercises: [
        {
          exerciseTemplateId: 'bench-template',
          slotId: 'bench-slot',
          name: 'Bench Press',
          sets: 3,
          repRange: [8, 12],
          effort: { type: 'rir', value: [2, 3] },
          restSeconds: 120,
          startingLoadKg: 70,
          progression: {
            rule: 'double_progression',
            loadIncrementKg: 2.5,
            triggerReps: 12,
          },
          note: 'Controlled reps.',
          rationale: 'Progressing slot.',
        },
      ],
    },
    {
      day: 2,
      title: 'Lower A',
      focus: 'Lower',
      exercises: [
        {
          exerciseTemplateId: 'leg-template',
          slotId: null,
          name: 'Leg Press',
          sets: 3,
          repRange: [8, 12],
          effort: { type: 'rir', value: 2 },
          restSeconds: 120,
          startingLoadKg: 100,
          progression: { rule: 'hold', loadIncrementKg: 5 },
          note: 'Controlled reps.',
          rationale: 'Hold while establishing a baseline.',
        },
      ],
    },
  ],
};

afterEach(() => {
  delete process.env.HEVY_ROUTINE_CONFIRM_SECRET;
});

describe('program schema v2', () => {
  it('normalizes legacy reps/effort and anchors familiar exercise loads', () => {
    const normalized = normalizeProgramV2(
      {
        title: 'Legacy block',
        days: [
          {
            day: 1,
            title: 'Upper',
            focus: 'Chest',
            exercises: [
              { name: 'Bench Press', sets: 3, reps: '8–12', effort: '2–3 RIR', restSeconds: 90 },
            ],
          },
          {
            day: 2,
            title: 'Lower',
            focus: 'Legs',
            exercises: [{ name: 'New Movement', sets: 2, reps: '10', effort: 'RPE 8', restSeconds: 60 }],
          },
        ],
      },
      { goal: 'Build muscle', durationWeeks: 8, daysPerWeek: 2, minutesPerSession: 60 },
      profile,
      dashboard,
    );
    expect(normalized?.schemaVersion).toBe(2);
    expect(normalized?.days[0].exercises[0].exerciseTemplateId).toBe('bench-template');
    expect(normalized?.days[0].exercises[0].startingLoadKg).toBe(70);
    expect(normalized?.days[0].exercises[0].repRange).toEqual([8, 12]);
    expect(normalized?.days[1].exercises[0].effort.type).toBe('rpe');
  });

  it('rejects a program whose estimated session time misses the requested window', () => {
    expect(validateProgramV2({ ...program, minutesPerSession: 8 }, { requireTimeMatch: true })).toBeNull();
    const tooShort = { ...program, minutesPerSession: 120 };
    expect(validateProgramV2(tooShort, { requireTimeMatch: true })).toContain('outside');
  });
});

describe('next session and Hevy routine confirmation', () => {
  it('adds the configured increment after the rep target is reached', () => {
    const session = resolveNextSession(
      program,
      {
        progressionStates: [
          {
            exerciseTemplateId: 'bench-template',
            slotId: 'bench-slot',
            title: 'Bench Press',
            modalLoadKg: 70,
            repsAtModalLoad: [12, 12, 12],
            lastSetRpe: [8],
            sessionsAnalyzed: 8,
            lastPerformedAt: '2026-09-20T00:00:00.000Z',
          },
        ],
      } as unknown as DashboardData,
      profile,
    );
    expect(session?.exercises[0].loadKg).toBe(72.5);
    expect(session?.exercises[0].load).toBe('159.8 lb');
  });

  it('requires a fresh signed preview token before a routine write', async () => {
    process.env.HEVY_ROUTINE_CONFIRM_SECRET = 'test-secret';
    const payload = buildRoutinePayload(program, 0);
    const confirmation = await createConfirmationToken('user-1', program.id, 0, payload, 1_000);
    expect(await verifyConfirmationToken(confirmation.token, 'user-1', program.id, 0, payload, 2_000)).toBe(true);
    expect(await verifyConfirmationToken(confirmation.token, 'user-1', program.id, 1, payload, 2_000)).toBe(false);
    expect(await verifyConfirmationToken(confirmation.token, 'user-1', program.id, 0, payload, confirmation.expiresAt + 1)).toBe(false);
  });
});
