import { describe, expect, it } from 'vitest';

import { analyzeWorkoutHistory } from '../lib/hevy';
import { ANALYSIS_ENGINE_VERSION } from '../lib/analysis-contracts';
import { ATHLETE_FIXTURES } from './fixtures/athletes';

const expectedWorkoutCounts: Record<string, number> = {
  novice: 26 * 3,
  intermediate: 26 * 4,
  advanced: 26 * 5,
};

describe.each(Object.entries(ATHLETE_FIXTURES))(
  '%s athlete fixture',
  (name, fixture) => {
    it('covers 26 weeks with unique workouts and known templates', () => {
      expect(fixture.workouts).toHaveLength(expectedWorkoutCounts[name]);
      expect(new Set(fixture.workouts.map((workout) => workout.id)).size).toBe(
        fixture.workouts.length,
      );

      const templateIds = new Set(
        fixture.templates.map((template) => template.id),
      );
      const referencedTemplateIds = fixture.workouts.flatMap((workout) =>
        workout.exercises.map((exercise) => exercise.exercise_template_id),
      );
      expect(
        referencedTemplateIds.every((templateId) =>
          templateIds.has(templateId),
        ),
      ).toBe(true);
    });

    it('produces repeatable output when the analysis clock is fixed', () => {
      const first = analyzeWorkoutHistory(
        fixture.workouts,
        fixture.templates,
        fixture.athleteName,
        fixture.now,
      );
      const second = analyzeWorkoutHistory(
        fixture.workouts,
        fixture.templates,
        fixture.athleteName,
        fixture.now,
      );

      expect(second).toEqual(first);
      expect(first.analysis).toMatchObject({
        version: ANALYSIS_ENGINE_VERSION,
        generatedAt: fixture.now.toISOString(),
        coverage: {
          workoutCount: fixture.workouts.length,
          templateCount: fixture.templates.length,
        },
      });
      expect(first.stats.sessions30d).toBeGreaterThan(0);
      expect(first.calendarWorkouts).toHaveLength(fixture.workouts.length);
    });
  },
);

describe('current analysis regression baseline', () => {
  it('pins the version six analysis output', () => {
    const summaries = Object.fromEntries(
      Object.entries(ATHLETE_FIXTURES).map(([name, fixture]) => {
        const dashboard = analyzeWorkoutHistory(
          fixture.workouts,
          fixture.templates,
          fixture.athleteName,
          fixture.now,
        );
        return [
          name,
          {
            sessions30d: dashboard.stats.sessions30d,
            workingSets7d: dashboard.stats.workingSets7d,
            totalVolume30dKg: dashboard.stats.totalVolume30dKg,
            volumeChangePercent: dashboard.stats.volumeChangePercent,
            trendExercise: dashboard.trend.exercise,
            trendChange: dashboard.trend.change,
            recordExercises: dashboard.records.map((record) => record.exercise),
          },
        ];
      }),
    );

    expect(summaries).toEqual({
      novice: {
        sessions30d: 12,
        workingSets7d: 18,
        totalVolume30dKg: 58_230,
        volumeChangePercent: -28.8,
        trendExercise: 'Squat (Barbell)',
        trendChange: 0.76,
        recordExercises: [
          'Squat (Barbell)',
          'Bench Press (Barbell)',
          'Standing Calf Raise (Machine)',
          'Romanian Deadlift (Barbell)',
          'Overhead Press (Barbell)',
        ],
      },
      intermediate: {
        sessions30d: 16,
        workingSets7d: 31,
        totalVolume30dKg: 127_429,
        volumeChangePercent: -15.3,
        trendExercise: 'Romanian Deadlift (Barbell)',
        trendChange: 0.6,
        recordExercises: [
          'Lat Pulldown (Cable)',
          'Seated Row (Machine)',
          'Romanian Deadlift (Barbell)',
          'Incline Bench Press (Dumbbell)',
          'Overhead Press (Barbell)',
        ],
      },
      advanced: {
        sessions30d: 20,
        workingSets7d: 47,
        totalVolume30dKg: 154_798,
        volumeChangePercent: -12.6,
        trendExercise: 'Squat (Barbell)',
        trendChange: 0,
        recordExercises: [
          'Incline Bench Press (Barbell)',
        ],
      },
    });
  });
});
