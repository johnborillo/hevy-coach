import { describe, expect, it } from 'vitest';

import type { DashboardData } from '../lib/hevy';
import type { ExerciseTemplate, HevyWorkout } from '../lib/hevy-types';
import { buildContinuationProgram } from '../lib/program-continuation';
import type { ProgramRequest } from '../lib/program';
import type { AthleteProfile } from '../lib/storage';

const request: ProgramRequest = {
  goal: 'Build muscle and strength',
  durationWeeks: 8,
  daysPerWeek: 2,
  minutesPerSession: 60,
  preferences: '',
};

const profile = {
  timezone: 'UTC',
  loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
} as AthleteProfile;

const templates: ExerciseTemplate[] = [
  {
    id: 'bench',
    title: 'Bench Press',
    primary_muscle_group: 'chest',
    equipment: 'barbell',
  },
  {
    id: 'row',
    title: 'Seated Row',
    primary_muscle_group: 'upper_back',
    equipment: 'cable',
  },
  {
    id: 'leg-press',
    title: 'Leg Press',
    primary_muscle_group: 'quadriceps',
    equipment: 'machine',
  },
  {
    id: 'leg-curl',
    title: 'Leg Curl',
    primary_muscle_group: 'hamstrings',
    equipment: 'machine',
  },
];

function workout(
  id: string,
  title: string,
  date: string,
  exercises: Array<[string, string, number]>,
): HevyWorkout {
  return {
    id,
    title,
    start_time: `${date}T12:00:00.000Z`,
    end_time: `${date}T13:00:00.000Z`,
    exercises: exercises.map(([templateId, name, sets]) => ({
      title: name,
      exercise_template_id: templateId,
      sets: Array.from({ length: sets }, () => ({
        type: 'normal',
        weight_kg: 50,
        reps: 8,
        rpe: 8,
      })),
    })),
  };
}

const workouts = [
  workout('upper-2', 'Upper A', '2026-09-20', [
    ['bench', 'Bench Press', 4],
    ['row', 'Seated Row', 3],
  ]),
  workout('lower-2', 'Lower A', '2026-09-18', [
    ['leg-press', 'Leg Press', 3],
    ['leg-curl', 'Leg Curl', 3],
  ]),
  workout('upper-1', 'Upper A', '2026-09-13', [
    ['bench', 'Bench Press', 2],
    ['row', 'Seated Row', 3],
  ]),
  workout('lower-1', 'Lower A', '2026-09-11', [
    ['leg-press', 'Leg Press', 3],
    ['leg-curl', 'Leg Curl', 2],
  ]),
];

const dashboard = {
  exerciseStats: templates.map((template) => ({
    exerciseTemplateId: template.id,
    slotId: null,
    exercise: template.title,
  })),
  progressionStates: templates.map((template) => ({
    exerciseTemplateId: template.id,
    slotId: null,
    title: template.title,
    targetRepRange: [8, 12],
    modalLoadKg: 50,
    recommendation: template.id === 'bench' ? 'add_load' : 'hold',
    rationale: 'Recent sessions provide a repeatable baseline.',
  })),
} as unknown as DashboardData;

describe('deterministic continuation programs', () => {
  it('continues the recent split without introducing unlogged exercises', () => {
    const program = buildContinuationProgram(
      request,
      profile,
      dashboard,
      workouts,
      templates,
      [],
      new Date('2026-09-22T12:00:00.000Z'),
    );

    expect(program?.days.map((day) => day.title).sort()).toEqual([
      'Lower A',
      'Upper A',
    ]);
    const sourceExerciseIds = new Set(
      workouts.flatMap((item) =>
        item.exercises.map((exercise) => exercise.exercise_template_id),
      ),
    );
    expect(
      program?.days.every((day) =>
        day.exercises.every((exercise) =>
          sourceExerciseIds.has(exercise.exerciseTemplateId ?? ''),
        ),
      ),
    ).toBe(true);
    const upper = program?.days.find((day) => day.title === 'Upper A');
    expect(upper?.exercises.map((exercise) => exercise.name)).toEqual([
      'Bench Press',
      'Seated Row',
    ]);
    expect(upper?.exercises[0].sets).toBe(3);
    expect(upper?.exercises[0].startingLoadKg).toBe(52.5);
  });

  it('returns null when the history cannot supply enough distinct days', () => {
    expect(
      buildContinuationProgram(
        request,
        profile,
        dashboard,
        workouts.filter((item) => item.title === 'Upper A'),
        templates,
        [],
        new Date('2026-09-22T12:00:00.000Z'),
      ),
    ).toBeNull();
  });
});
