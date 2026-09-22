import { describe, expect, it } from 'vitest';
import { analyzeWorkoutHistory } from '../lib/hevy';
import { MUSCLES, resolveMuscles } from '../lib/muscles';

describe('muscle resolution', () => {
  it('preserves specific Hevy tags and only refines coarse tags', () => {
    expect(
      resolveMuscles({
        id: 'lat-row',
        title: 'Lat Row',
        primary_muscle_group: 'lats',
      }).primary,
    ).toBe('lats');
    expect(
      resolveMuscles({
        id: 'cable-row',
        title: 'Seated Cable Row',
        primary_muscle_group: 'upper_back',
      }).primary,
    ).toBe('upper_back');
    expect(
      resolveMuscles({
        id: 'arnold-press',
        title: 'Arnold Press',
        primary_muscle_group: 'shoulders',
      }).primary,
    ).toBe('delts_front');
  });

  it('splits coarse shoulder templates by movement title', () => {
    expect(
      resolveMuscles({
        id: 'lateral',
        title: 'Lateral Raise (Dumbbell)',
        primary_muscle_group: 'shoulders',
      }).primary,
    ).toBe('delts_side');
    expect(
      resolveMuscles({
        id: 'reverse',
        title: 'Reverse Fly (Machine)',
        primary_muscle_group: 'shoulders',
      }).primary,
    ).toBe('delts_rear');
  });

  it('maps secondary muscles without duplicating the primary', () => {
    expect(
      resolveMuscles({
        id: 'bench',
        title: 'Bench Press (Barbell)',
        primary_muscle_group: 'chest',
        secondary_muscle_groups: ['triceps', 'shoulders', 'chest'],
      }),
    ).toEqual({
      primary: 'chest_mid_lower',
      secondary: ['triceps', 'delts_front'],
      unmapped: false,
    });
  });

  it('lets a user override replace template defaults', () => {
    expect(
      resolveMuscles(
        {
          id: 'custom',
          title: 'My Press',
          primary_muscle_group: 'shoulders',
          is_custom: true,
        },
        {
          exerciseTemplateId: 'custom',
          primaryMuscle: 'chest_upper',
          secondaryMuscles: ['triceps', 'chest_upper'],
          countsAs: 1,
        },
      ),
    ).toEqual({
      primary: 'chest_upper',
      secondary: ['triceps'],
      unmapped: false,
    });
  });

  it('keeps the complete taxonomy available for zero-filled audits', () => {
    expect(MUSCLES).toContain('calves');
    expect(MUSCLES).toContain('delts_rear');
    expect(MUSCLES).toHaveLength(22);
  });

  it('zero-fills the audit and separates direct from indirect sets', () => {
    const dashboard = analyzeWorkoutHistory(
      [
        {
          id: 'upper',
          title: 'Upper',
          start_time: '2026-09-20T12:00:00.000Z',
          end_time: '2026-09-20T13:00:00.000Z',
          exercises: [
            {
              title: 'Bench Press (Barbell)',
              exercise_template_id: 'bench',
              sets: [
                { type: 'normal', weight_kg: 80, reps: 6 },
                { type: 'normal', weight_kg: 80, reps: 6 },
              ],
            },
            {
              title: 'Lateral Raise (Dumbbell)',
              exercise_template_id: 'lateral',
              sets: [
                { type: 'normal', weight_kg: 10, reps: 12 },
                { type: 'normal', weight_kg: 10, reps: 12 },
                { type: 'normal', weight_kg: 10, reps: 12 },
              ],
            },
          ],
        },
      ],
      [
        {
          id: 'bench',
          title: 'Bench Press (Barbell)',
          primary_muscle_group: 'chest',
          secondary_muscle_groups: ['triceps', 'shoulders'],
          equipment: 'barbell',
        },
        {
          id: 'lateral',
          title: 'Lateral Raise (Dumbbell)',
          primary_muscle_group: 'shoulders',
          equipment: 'dumbbell',
        },
      ],
      'Athlete',
      new Date('2026-09-21T12:00:00.000Z'),
    );

    expect(dashboard.muscles).toHaveLength(MUSCLES.length);
    expect(
      dashboard.muscles.find((muscle) => muscle.key === 'chest_mid_lower'),
    ).toMatchObject({ sets: 2, indirectSets: 0 });
    expect(
      dashboard.muscles.find((muscle) => muscle.key === 'triceps'),
    ).toMatchObject({ sets: 0, indirectSets: 1 });
    expect(
      dashboard.muscles.find((muscle) => muscle.key === 'delts_side'),
    ).toMatchObject({ sets: 3 });
    expect(
      dashboard.muscles.find((muscle) => muscle.key === 'calves'),
    ).toMatchObject({ sets: 0, indirectSets: 0 });
  });

  it('applies user overrides to the audit immediately', () => {
    const dashboard = analyzeWorkoutHistory(
      [
        {
          id: 'custom-day',
          title: 'Custom',
          start_time: '2026-09-20T12:00:00.000Z',
          end_time: '2026-09-20T13:00:00.000Z',
          exercises: [
            {
              title: 'Custom Sweep',
              exercise_template_id: 'custom',
              sets: [{ type: 'normal', weight_kg: 20, reps: 10 }],
            },
          ],
        },
      ],
      [
        {
          id: 'custom',
          title: 'Custom Sweep',
          is_custom: true,
        },
      ],
      'Athlete',
      new Date('2026-09-21T12:00:00.000Z'),
      [
        {
          exerciseTemplateId: 'custom',
          primaryMuscle: 'delts_rear',
          secondaryMuscles: [],
          countsAs: 1,
        },
      ],
    );

    expect(
      dashboard.muscles.find((muscle) => muscle.key === 'delts_rear'),
    ).toMatchObject({ sets: 1 });
    expect(dashboard.unmappedExercises).toEqual([]);
  });
});
