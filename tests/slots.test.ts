import { describe, expect, it } from 'vitest';
import { inferSlotPattern, suggestSlots } from '../lib/slots';
import { analyzeWorkoutHistory } from '../lib/hevy';

describe('exercise slots', () => {
  it('infers common movement patterns before falling back to isolation', () => {
    expect(inferSlotPattern('Incline Bench Press (Dumbbell)')).toBe(
      'horizontal_press',
    );
    expect(inferSlotPattern('Shoulder Press (Machine)')).toBe('vertical_press');
    expect(inferSlotPattern('Romanian Deadlift')).toBe('hinge');
    expect(inferSlotPattern('Cable Lateral Raise')).toBe('isolation');
  });

  it('only suggests a slot when multiple templates share a muscle and pattern', () => {
    const suggestions = suggestSlots([
      {
        id: 'db',
        title: 'Incline Bench Press (Dumbbell)',
        primary_muscle_group: 'chest',
      },
      {
        id: 'barbell',
        title: 'Incline Bench Press (Barbell)',
        primary_muscle_group: 'chest',
      },
      {
        id: 'curl',
        title: 'Incline Curl (Dumbbell)',
        primary_muscle_group: 'biceps',
      },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      name: 'Upper Chest Press',
      templateIds: ['db', 'barbell'],
    });
  });

  it('groups progression history across assigned variations', () => {
    const workouts = [0, 1, 2, 3].map((index) => ({
      id: `workout-${index}`,
      title: 'Upper',
      start_time: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      end_time: `2026-09-${String(index + 1).padStart(2, '0')}T13:00:00.000Z`,
      exercises: [
        {
          title:
            index < 2
              ? 'Incline Bench Press (Dumbbell)'
              : 'Incline Bench Press (Barbell)',
          exercise_template_id: index < 2 ? 'db' : 'barbell',
          sets: [{ type: 'normal', weight_kg: 60 + index, reps: 8, rpe: 8 }],
        },
      ],
    }));
    const dashboard = analyzeWorkoutHistory(
      workouts,
      [
        {
          id: 'db',
          title: 'Incline Bench Press (Dumbbell)',
          primary_muscle_group: 'chest',
        },
        {
          id: 'barbell',
          title: 'Incline Bench Press (Barbell)',
          primary_muscle_group: 'chest',
        },
      ],
      'Athlete',
      new Date('2026-09-05T12:00:00.000Z'),
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
    expect(dashboard.progressionStates).toHaveLength(1);
    expect(dashboard.progressionStates[0]).toMatchObject({
      slotId: 'slot-incline',
      variationChangeAt: '2026-09-03T12:00:00.000Z',
    });
    expect(
      dashboard.exerciseStats.every(
        (exercise) => exercise.slotId === 'slot-incline',
      ),
    ).toBe(true);
  });
});
