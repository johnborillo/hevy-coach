import { describe, expect, it } from 'vitest';

import { detectRecords, selectRecentRecords } from '../lib/records';
import type { HevyWorkout } from '../lib/hevy-types';

function workouts(
  title: string,
  templateId: string,
  loads: number[],
  reps = 6,
): HevyWorkout[] {
  return loads.map((load, index) => ({
    id: `workout-${index + 1}`,
    title: 'Upper',
    start_time: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    end_time: `2026-08-${String(index + 1).padStart(2, '0')}T13:00:00.000Z`,
    exercises: [
      {
        title,
        exercise_template_id: templateId,
        sets: [
          { type: 'normal', weight_kg: load, reps, rpe: 8 },
          { type: 'normal', weight_kg: load, reps, rpe: 8.5 },
        ],
      },
    ],
  }));
}

describe('personal record detection', () => {
  it('does not call the first five exposures PRs', () => {
    const records = detectRecords(
      workouts('Bench Press (Barbell)', 'bench', [80, 80, 80, 80, 80]),
      [
        {
          id: 'bench',
          title: 'Bench Press (Barbell)',
          primary_muscle_group: 'chest',
          equipment: 'barbell',
        },
      ],
    );
    expect(records).toEqual([]);
  });

  it('emits a real e1RM PR after a five-session baseline', () => {
    const records = detectRecords(
      workouts('Bench Press (Barbell)', 'bench', [80, 80, 80, 80, 80, 82.5]),
      [
        {
          id: 'bench',
          title: 'Bench Press (Barbell)',
          primary_muscle_group: 'chest',
          equipment: 'barbell',
        },
      ],
    );
    expect(records.some((record) => record.kind === 'e1rm')).toBe(true);
    expect(records.find((record) => record.kind === 'e1rm')).toMatchObject({
      previousValue: 96,
      loadKg: 82.5,
      reps: 6,
    });
  });

  it('tracks an isolation lift with load-at-reps instead of e1RM', () => {
    const records = detectRecords(
      workouts('Cable Lateral Raise', 'lateral', [10, 10, 10, 10, 10, 12], 10),
      [
        {
          id: 'lateral',
          title: 'Cable Lateral Raise',
          primary_muscle_group: 'shoulders',
          equipment: 'cable',
        },
      ],
    );
    expect(records.some((record) => record.kind === 'e1rm')).toBe(false);
    expect(records.some((record) => record.kind === 'load_at_reps')).toBe(true);
  });

  it('prefers a slot-level signal when a variation changes', () => {
    const db = workouts(
      'Incline Bench Press (Dumbbell)',
      'db',
      [60, 60, 60, 60, 60],
    );
    const barbell = workouts('Incline Bench Press (Barbell)', 'barbell', [65]);
    barbell[0].start_time = '2026-08-06T12:00:00.000Z';
    const records = detectRecords(
      [...db, ...barbell],
      [
        {
          id: 'db',
          title: 'Incline Bench Press (Dumbbell)',
          primary_muscle_group: 'chest',
          equipment: 'dumbbell',
        },
        {
          id: 'barbell',
          title: 'Incline Bench Press (Barbell)',
          primary_muscle_group: 'chest',
          equipment: 'barbell',
        },
      ],
      [
        {
          exerciseTemplateId: 'db',
          primaryMuscle: 'chest_upper',
          secondaryMuscles: [],
          countsAs: 1,
          slotId: 'slot-incline',
        },
        {
          exerciseTemplateId: 'barbell',
          primaryMuscle: 'chest_upper',
          secondaryMuscles: [],
          countsAs: 1,
          slotId: 'slot-incline',
        },
      ],
      [
        {
          id: 'slot-incline',
          name: 'Incline press',
          primaryMuscle: 'chest_upper',
          pattern: 'horizontal_press',
          templateIds: ['db', 'barbell'],
        },
      ],
    );
    const recent = selectRecentRecords(records, new Date('2026-08-07T00:00:00.000Z'));
    expect(recent.some((record) => record.scope === 'slot')).toBe(true);
    expect(recent.some((record) => record.scope === 'template' && record.slotId)).toBe(false);
  });
});
