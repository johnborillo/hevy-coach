import type { ExerciseTemplate, HevySet, HevyWorkout } from './hevy-types';

export type StoredHevyWorkout = {
  userId: string;
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  description: string | null;
  sourceUpdatedAt: string | null;
  rawJson: string;
  deleted: number;
  syncedAt: string;
};

export type StoredHevySet = {
  userId: string;
  id: string;
  workoutId: string;
  exerciseTemplateId: string;
  exerciseTitle: string;
  exerciseIndex: number;
  setIndex: number;
  setType: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  exerciseNotes: string | null;
  performedAt: string;
};

export type StoredHevyTemplate = {
  userId: string;
  id: string;
  title: string;
  primaryMuscle: string | null;
  secondaryMusclesJson: string;
  equipment: string | null;
  isCustom: number;
  syncedAt: string;
};

export type StoredWorkoutBundle = {
  workout: StoredHevyWorkout;
  sets: StoredHevySet[];
};

function optionalNumber(value: number | null | undefined) {
  return value ?? null;
}

function storedSetId(
  workoutId: string,
  exerciseIndex: number,
  setIndex: number,
) {
  return `${workoutId}:${exerciseIndex}:${setIndex}`;
}

function serializeSet(
  userId: string,
  workout: HevyWorkout,
  set: HevySet,
  exerciseIndex: number,
  setPosition: number,
): StoredHevySet {
  const exercise = workout.exercises[exerciseIndex];
  const setIndex = set.index ?? setPosition;
  return {
    userId,
    id: storedSetId(workout.id, exerciseIndex, setIndex),
    workoutId: workout.id,
    exerciseTemplateId: exercise.exercise_template_id,
    exerciseTitle: exercise.title,
    exerciseIndex,
    setIndex,
    setType: set.type ?? 'normal',
    weightKg: optionalNumber(set.weight_kg),
    reps: optionalNumber(set.reps),
    rpe: optionalNumber(set.rpe),
    durationSeconds: optionalNumber(set.duration_seconds),
    distanceMeters: optionalNumber(set.distance_meters),
    exerciseNotes: exercise.notes ?? null,
    performedAt: workout.start_time,
  };
}

export function serializeHevyWorkout(
  userId: string,
  workout: HevyWorkout,
  syncedAt = new Date().toISOString(),
): StoredWorkoutBundle {
  return {
    workout: {
      userId,
      id: workout.id,
      title: workout.title,
      startTime: workout.start_time,
      endTime: workout.end_time,
      description: workout.description ?? null,
      sourceUpdatedAt: workout.updated_at ?? null,
      rawJson: JSON.stringify(workout),
      deleted: 0,
      syncedAt,
    },
    sets: workout.exercises.flatMap((exercise, exerciseIndex) =>
      exercise.sets.map((set, setIndex) =>
        serializeSet(userId, workout, set, exerciseIndex, setIndex),
      ),
    ),
  };
}

export function deserializeHevyWorkout(
  row: Pick<StoredHevyWorkout, 'rawJson'>,
) {
  return JSON.parse(row.rawJson) as HevyWorkout;
}

export function serializeHevyTemplate(
  userId: string,
  template: ExerciseTemplate,
  syncedAt = new Date().toISOString(),
): StoredHevyTemplate {
  return {
    userId,
    id: template.id,
    title: template.title,
    primaryMuscle: template.primary_muscle_group ?? null,
    secondaryMusclesJson: JSON.stringify(
      template.secondary_muscle_groups ?? [],
    ),
    equipment: template.equipment ?? null,
    isCustom: template.is_custom ? 1 : 0,
    syncedAt,
  };
}

export function deserializeSecondaryMuscles(
  row: Pick<StoredHevyTemplate, 'secondaryMusclesJson'>,
) {
  const value: unknown = JSON.parse(row.secondaryMusclesJson);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
