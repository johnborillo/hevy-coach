import type { ExerciseTemplate, HevyWorkout } from './hevy-types';

export const ANALYSIS_ENGINE_VERSION = 4;

export type AnalysisCoverage = {
  workoutCount: number;
  setCount: number;
  templateCount: number;
  oldestWorkoutAt: string | null;
  newestWorkoutAt: string | null;
};

export type AnalysisMetadata = {
  version: number;
  generatedAt: string;
  coverage: AnalysisCoverage;
};

export function createAnalysisMetadata(
  workouts: HevyWorkout[],
  templates: ExerciseTemplate[],
  generatedAt = new Date(),
): AnalysisMetadata {
  const timestamps = workouts
    .map((workout) => workout.start_time)
    .filter((value) => Number.isFinite(new Date(value).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return {
    version: ANALYSIS_ENGINE_VERSION,
    generatedAt: generatedAt.toISOString(),
    coverage: {
      workoutCount: workouts.length,
      setCount: workouts.reduce(
        (total, workout) =>
          total +
          workout.exercises.reduce(
            (exerciseTotal, exercise) => exerciseTotal + exercise.sets.length,
            0,
          ),
        0,
      ),
      templateCount: templates.length,
      oldestWorkoutAt: timestamps[0] ?? null,
      newestWorkoutAt: timestamps.at(-1) ?? null,
    },
  };
}
