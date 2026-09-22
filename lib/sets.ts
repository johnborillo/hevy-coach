import type { ExerciseTemplate, HevySet } from './hevy-types';

export type SetClass =
  | 'warmup'
  | 'working'
  | 'dropset'
  | 'failure'
  | 'timed'
  | 'distance'
  | 'invalid';

export type SetExercise = Pick<
  ExerciseTemplate,
  'title' | 'equipment' | 'primary_muscle_group'
>;

export type ClassifiedSet = {
  cls: SetClass;
  countsAsWorking: number;
  loadKg: number | null;
  reps: number | null;
  rpe: number | null;
  e1rmEligible: boolean;
  e1rmKg: number | null;
  loadVolumeKg: number | null;
  repVolume: number | null;
};

const ISOLATION_MUSCLES = new Set([
  'abdominals',
  'abs',
  'biceps',
  'calves',
  'forearms',
  'triceps',
]);

const COMPOUND_PATTERN =
  /press|squat|deadlift|hinge|row|pulldown|pull[- ]?up|chin[- ]?up|hip thrust|good morning/i;
const ISOLATION_PATTERN =
  /lateral raise|front raise|reverse fly|pec deck|curl|extension|pushdown|calf|shrug|crunch|abduction|adduction/i;
const BODYWEIGHT_PATTERN =
  /pull[- ]?up|chin[- ]?up|push[- ]?up|bodyweight|muscle[- ]?up|(?:chest )?dip/i;
const ASSISTED_PATTERN = /assisted/i;

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function setClass(set: HevySet): SetClass {
  const type = normalize(set.type);
  if (type === 'warmup') return 'warmup';
  if (set.distance_meters != null && set.reps == null) return 'distance';
  if (set.duration_seconds != null && set.reps == null) return 'timed';
  if (set.reps == null || set.reps < 0) return 'invalid';
  if (type === 'dropset') return 'dropset';
  if (type === 'failure') return 'failure';
  return 'working';
}

export function compoundEligible(exercise: SetExercise) {
  const muscle = normalize(exercise.primary_muscle_group);
  return (
    !ISOLATION_MUSCLES.has(muscle) &&
    COMPOUND_PATTERN.test(exercise.title) &&
    !ISOLATION_PATTERN.test(exercise.title)
  );
}

export function classifySet(
  set: HevySet,
  exercise: SetExercise,
  options: { bodyweightKg?: number | null; dropsetWeight?: number } = {},
): ClassifiedSet {
  const cls = setClass(set);
  const bodyweightKg = options.bodyweightKg ?? null;
  const dropsetWeight = Math.min(Math.max(options.dropsetWeight ?? 0.5, 0), 1);
  const equipment = normalize(exercise.equipment);
  const assisted =
    equipment === 'assisted' || ASSISTED_PATTERN.test(exercise.title);
  const bodyweight =
    assisted ||
    equipment === 'bodyweight' ||
    equipment === 'none' ||
    BODYWEIGHT_PATTERN.test(exercise.title);

  let loadKg = set.weight_kg ?? null;
  if (assisted) {
    loadKg =
      bodyweightKg == null
        ? null
        : Math.max(0, bodyweightKg - (set.weight_kg ?? 0));
  } else if (bodyweight) {
    loadKg =
      bodyweightKg == null
        ? (set.weight_kg ?? 0)
        : bodyweightKg + (set.weight_kg ?? 0);
  }

  const countsAsWorking =
    cls === 'working' || cls === 'failure'
      ? 1
      : cls === 'dropset'
        ? dropsetWeight
        : 0;
  const reps = set.reps ?? null;
  const rpe = set.rpe ?? (cls === 'failure' ? 10 : null);
  const e1rmEligible = Boolean(
    (cls === 'working' || cls === 'failure') &&
    reps != null &&
    reps >= 1 &&
    reps <= 8 &&
    loadKg != null &&
    loadKg > 0 &&
    !assisted &&
    (!bodyweight || bodyweightKg != null) &&
    compoundEligible(exercise),
  );
  const e1rmKg =
    e1rmEligible && loadKg != null && reps != null
      ? loadKg * (1 + reps / 30)
      : null;
  const loadVolumeKg =
    countsAsWorking > 0 && !bodyweight && loadKg != null && reps != null
      ? loadKg * reps * countsAsWorking
      : null;
  const repVolume =
    countsAsWorking > 0 && bodyweight && reps != null
      ? reps * countsAsWorking
      : null;

  return {
    cls,
    countsAsWorking,
    loadKg,
    reps,
    rpe,
    e1rmEligible,
    e1rmKg,
    loadVolumeKg,
    repVolume,
  };
}
