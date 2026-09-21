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
  it('pins the existing engine output before V2 calculation changes', () => {
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
        workingSets7d: 27,
        totalVolume30dKg: 58_230,
        volumeChangePercent: 1.5,
        trendExercise: 'Squat (Barbell)',
        trendChange: 7.5,
        recordExercises: [
          'Romanian Deadlift (Barbell)',
          'Squat (Barbell)',
          'Standing Calf Raise (Machine)',
          'Lat Pulldown (Cable)',
          'Seated Row (Machine)',
        ],
      },
      intermediate: {
        sessions30d: 17,
        workingSets7d: 42,
        totalVolume30dKg: 136_062,
        volumeChangePercent: 9.9,
        trendExercise: 'Squat (Barbell)',
        trendChange: -8.9,
        recordExercises: [
          'Squat (Barbell)',
          'Romanian Deadlift (Barbell)',
          'Standing Calf Raise (Machine)',
          'Bench Press (Barbell)',
          'Lat Pulldown (Cable)',
        ],
      },
      advanced: {
        sessions30d: 21,
        workingSets7d: 58,
        totalVolume30dKg: 168_819,
        volumeChangePercent: 1,
        trendExercise: 'Squat (Barbell)',
        trendChange: -9,
        recordExercises: [
          'Squat (Barbell)',
          'Romanian Deadlift (Barbell)',
          'Standing Calf Raise (Machine)',
          'Bench Press (Barbell)',
          'Seated Row (Machine)',
        ],
      },
    });
  });
});
