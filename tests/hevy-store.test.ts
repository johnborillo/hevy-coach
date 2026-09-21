import { describe, expect, it } from 'vitest';
import {
  deserializeHevyWorkout,
  deserializeSecondaryMuscles,
  serializeHevyTemplate,
  serializeHevyWorkout,
} from '../lib/hevy-store';
import type { ExerciseTemplate, HevyWorkout } from '../lib/hevy-types';

const workout: HevyWorkout = {
  id: 'workout-1',
  title: 'Conditioning and pull',
  start_time: '2026-09-20T14:00:00.000Z',
  end_time: '2026-09-20T15:05:00.000Z',
  description: 'First week back',
  updated_at: '2026-09-20T16:00:00.000Z',
  exercises: [
    {
      title: 'Rowing Machine',
      exercise_template_id: 'template-row',
      notes: 'Moderate pace',
      sets: [
        {
          index: 2,
          type: 'normal',
          duration_seconds: 600,
          distance_meters: 2_000,
          rpe: 7.5,
        },
      ],
    },
    {
      title: 'Lat Pulldown',
      exercise_template_id: 'template-pulldown',
      sets: [{ weight_kg: 70, reps: 8 }],
    },
  ],
};

describe('Hevy workout storage serialization', () => {
  it('preserves the raw workout and denormalizes every set', () => {
    const bundle = serializeHevyWorkout(
      'athlete-1',
      workout,
      '2026-09-21T10:00:00.000Z',
    );

    expect(bundle.workout).toMatchObject({
      userId: 'athlete-1',
      id: 'workout-1',
      description: 'First week back',
      sourceUpdatedAt: '2026-09-20T16:00:00.000Z',
      deleted: 0,
    });
    expect(deserializeHevyWorkout(bundle.workout)).toEqual(workout);
    expect(bundle.sets).toHaveLength(2);
    expect(bundle.sets[0]).toMatchObject({
      id: 'workout-1:0:2',
      exerciseTemplateId: 'template-row',
      durationSeconds: 600,
      distanceMeters: 2_000,
      rpe: 7.5,
      exerciseNotes: 'Moderate pace',
    });
    expect(bundle.sets[1]).toMatchObject({
      id: 'workout-1:1:0',
      weightKg: 70,
      reps: 8,
      setType: 'normal',
    });
  });

  it('uses stable IDs when Hevy omits a set index', () => {
    const first = serializeHevyWorkout('athlete-1', workout);
    const second = serializeHevyWorkout('athlete-1', workout);
    expect(first.sets.map((set) => set.id)).toEqual(
      second.sets.map((set) => set.id),
    );
  });
});

describe('Hevy template storage serialization', () => {
  it('preserves muscle metadata and custom-template state', () => {
    const template: ExerciseTemplate = {
      id: 'template-1',
      title: 'Chest-supported row',
      primary_muscle_group: 'upper_back',
      secondary_muscle_groups: ['biceps', 'lats'],
      equipment: 'machine',
      is_custom: true,
    };
    const row = serializeHevyTemplate('athlete-1', template, 'sync-time');

    expect(row).toMatchObject({
      userId: 'athlete-1',
      id: 'template-1',
      primaryMuscle: 'upper_back',
      isCustom: 1,
      syncedAt: 'sync-time',
    });
    expect(deserializeSecondaryMuscles(row)).toEqual(['biceps', 'lats']);
  });
});
