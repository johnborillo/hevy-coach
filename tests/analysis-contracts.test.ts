import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_ENGINE_VERSION,
  createAnalysisMetadata,
} from '../lib/analysis-contracts';
import type { ExerciseTemplate, HevyWorkout } from '../lib/hevy-types';

describe('createAnalysisMetadata', () => {
  it('reports deterministic source coverage for a calculation run', () => {
    const workouts: HevyWorkout[] = [
      {
        id: 'newer',
        title: 'Newer workout',
        start_time: '2026-09-18T12:00:00.000Z',
        end_time: '2026-09-18T13:00:00.000Z',
        exercises: [
          {
            title: 'Bench Press (Barbell)',
            exercise_template_id: 'bench',
            sets: [{ type: 'normal', weight_kg: 80, reps: 6 }],
          },
        ],
      },
      {
        id: 'older',
        title: 'Older workout',
        start_time: '2026-09-11T12:00:00.000Z',
        end_time: '2026-09-11T13:00:00.000Z',
        exercises: [
          {
            title: 'Squat (Barbell)',
            exercise_template_id: 'squat',
            sets: [
              { type: 'warmup', weight_kg: 60, reps: 5 },
              { type: 'normal', weight_kg: 100, reps: 5 },
            ],
          },
        ],
      },
    ];
    const templates: ExerciseTemplate[] = [
      { id: 'bench', title: 'Bench Press (Barbell)' },
      { id: 'squat', title: 'Squat (Barbell)' },
    ];

    expect(
      createAnalysisMetadata(
        workouts,
        templates,
        new Date('2026-09-21T12:00:00.000Z'),
      ),
    ).toEqual({
      version: ANALYSIS_ENGINE_VERSION,
      generatedAt: '2026-09-21T12:00:00.000Z',
      coverage: {
        workoutCount: 2,
        setCount: 3,
        templateCount: 2,
        oldestWorkoutAt: '2026-09-11T12:00:00.000Z',
        newestWorkoutAt: '2026-09-18T12:00:00.000Z',
      },
    });
  });

  it('handles an empty source without inventing coverage dates', () => {
    const metadata = createAnalysisMetadata(
      [],
      [],
      new Date('2026-09-21T12:00:00.000Z'),
    );

    expect(metadata.coverage).toEqual({
      workoutCount: 0,
      setCount: 0,
      templateCount: 0,
      oldestWorkoutAt: null,
      newestWorkoutAt: null,
    });
  });
});
