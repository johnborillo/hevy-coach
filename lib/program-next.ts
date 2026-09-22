import type { DashboardData } from './hevy';
import type { AthleteProfile, ProgramExercise, TrainingProgram } from './storage';
import { formatEffort, formatRepRange } from './program-v2';

export type NextSessionExercise = {
  name: string;
  exerciseTemplateId: string | null;
  slotId: string | null;
  sets: number;
  repRange: [number, number];
  reps: string;
  effort: string;
  loadKg: number | null;
  load: string | null;
  progression: ProgramExercise['progression'];
  rationale: string;
};

export type NextSession = {
  dayIndex: number;
  day: TrainingProgram['days'][number];
  exercises: NextSessionExercise[];
};

function displayLoad(valueKg: number | null, profile: AthleteProfile) {
  if (valueKg == null || !Number.isFinite(valueKg)) return null;
  const value = profile.weightUnit === 'kg' ? valueKg : valueKg * 2.2046226218;
  return `${Math.round(value * 10) / 10} ${profile.weightUnit}`;
}

function findState(
  exercise: ProgramExercise,
  dashboard: DashboardData,
) {
  return dashboard.progressionStates.find(
    (state) =>
      (exercise.exerciseTemplateId && state.exerciseTemplateId === exercise.exerciseTemplateId) ||
      (exercise.slotId && state.slotId === exercise.slotId) ||
      state.title.toLowerCase() === exercise.name.toLowerCase(),
  );
}

function resolveLoad(
  exercise: ProgramExercise,
  dashboard: DashboardData,
) {
  const state = findState(exercise, dashboard);
  const base = exercise.startingLoadKg ?? state?.modalLoadKg ?? null;
  if (base == null) return { load: null, state };
  const reps = state?.repsAtModalLoad.slice(-exercise.sets) ?? [];
  const reachedTarget =
    reps.length >= exercise.sets && reps.every((value) => value >= exercise.repRange[1]);
  const increment = exercise.progression.loadIncrementKg;
  const load =
    exercise.progression.rule === 'linear_load'
      ? base + increment
      : exercise.progression.rule === 'double_progression' ||
          exercise.progression.rule === 'rep_target_then_load'
        ? reachedTarget
          ? base + increment
          : base
        : base;
  return { load, state };
}

export function resolveNextSession(
  program: TrainingProgram,
  dashboard: DashboardData,
  profile: AthleteProfile,
  requestedDayIndex?: number,
): NextSession | null {
  if (!program.days.length) return null;
  const dayIndex =
    requestedDayIndex == null
      ? 0
      : ((Math.round(requestedDayIndex) % program.days.length) + program.days.length) %
        program.days.length;
  const day = program.days[dayIndex];
  if (!day) return null;
  const exercises = day.exercises.map((exercise) => {
    const resolved = resolveLoad(exercise, dashboard);
    const state = resolved.state;
    return {
      name: exercise.name,
      exerciseTemplateId: exercise.exerciseTemplateId,
      slotId: exercise.slotId,
      sets: exercise.sets,
      repRange: exercise.repRange,
      reps: formatRepRange(exercise.repRange),
      effort: formatEffort(exercise.effort),
      loadKg: resolved.load,
      load: displayLoad(resolved.load, profile),
      progression: exercise.progression,
      rationale:
        state?.rationale ??
        `${exercise.progression.rule.replaceAll('_', ' ')} from the saved starting load.`,
    } satisfies NextSessionExercise;
  });
  return { dayIndex, day, exercises };
}
