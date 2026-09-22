import { getDatabase } from '../db';
import type { ExerciseTemplate, HevyWorkout } from './hevy-types';
import {
  deserializeHevyWorkout,
  serializeHevyTemplate,
  serializeHevyWorkout,
  type StoredHevySet,
  type StoredHevyTemplate,
  type StoredHevyWorkout,
} from './hevy-store';

export { upsertHevyBodyWeights } from './body-weight-repo';

export type HevySyncState = {
  userId: string;
  lastEventSince: string | null;
  fullSyncNextPage: number;
  fullSyncPageCount: number | null;
  fullSyncCompletedAt: string | null;
  templatesSyncedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

type WorkoutRow = {
  user_id: string;
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  description: string | null;
  source_updated_at: string | null;
  raw_json: string;
  deleted: number;
  synced_at: string;
};

type SetRow = {
  user_id: string;
  id: string;
  workout_id: string;
  exercise_template_id: string;
  exercise_title: string;
  exercise_index: number;
  set_index: number;
  set_type: string;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  exercise_notes: string | null;
  performed_at: string;
};

type TemplateRow = {
  user_id: string;
  id: string;
  title: string;
  primary_muscle: string | null;
  secondary_muscles_json: string;
  equipment: string | null;
  is_custom: number;
  synced_at: string;
};

type SyncStateRow = {
  user_id: string;
  last_event_since: string | null;
  full_sync_next_page: number;
  full_sync_page_count: number | null;
  full_sync_completed_at: string | null;
  templates_synced_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

function mapWorkout(row: WorkoutRow): StoredHevyWorkout {
  return {
    userId: row.user_id,
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    description: row.description,
    sourceUpdatedAt: row.source_updated_at,
    rawJson: row.raw_json,
    deleted: row.deleted,
    syncedAt: row.synced_at,
  };
}

function mapSet(row: SetRow): StoredHevySet {
  return {
    userId: row.user_id,
    id: row.id,
    workoutId: row.workout_id,
    exerciseTemplateId: row.exercise_template_id,
    exerciseTitle: row.exercise_title,
    exerciseIndex: row.exercise_index,
    setIndex: row.set_index,
    setType: row.set_type,
    weightKg: row.weight_kg,
    reps: row.reps,
    rpe: row.rpe,
    durationSeconds: row.duration_seconds,
    distanceMeters: row.distance_meters,
    exerciseNotes: row.exercise_notes,
    performedAt: row.performed_at,
  };
}

function mapTemplate(row: TemplateRow): StoredHevyTemplate {
  return {
    userId: row.user_id,
    id: row.id,
    title: row.title,
    primaryMuscle: row.primary_muscle,
    secondaryMusclesJson: row.secondary_muscles_json,
    equipment: row.equipment,
    isCustom: row.is_custom,
    syncedAt: row.synced_at,
  };
}

export async function listStoredWorkouts(
  userId: string,
  options: {
    since?: string;
    until?: string;
    includeDeleted?: boolean;
    limit?: number;
  } = {},
) {
  const conditions = ['user_id = ?'];
  const bindings: Array<string | number> = [userId];
  if (!options.includeDeleted) conditions.push('deleted = 0');
  if (options.since) {
    conditions.push('start_time >= ?');
    bindings.push(options.since);
  }
  if (options.until) {
    conditions.push('start_time <= ?');
    bindings.push(options.until);
  }
  const limit = Math.min(Math.max(options.limit ?? 250, 1), 5_000);
  bindings.push(limit);

  const result = await getDatabase()
    .prepare(
      `SELECT user_id, id, title, start_time, end_time, description,
        source_updated_at, raw_json, deleted, synced_at
       FROM hevy_workouts WHERE ${conditions.join(' AND ')}
       ORDER BY start_time DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<WorkoutRow>();

  return result.results.map(mapWorkout);
}

export async function listStoredHevyWorkouts(
  userId: string,
  options: Parameters<typeof listStoredWorkouts>[1] = {},
) {
  const rows = await listStoredWorkouts(userId, options);
  return rows.map(deserializeHevyWorkout);
}

export async function listStoredSets(
  userId: string,
  options: {
    since?: string;
    until?: string;
    exerciseTemplateId?: string;
    workoutId?: string;
  } = {},
) {
  const conditions = ['user_id = ?'];
  const bindings: string[] = [userId];
  if (options.since) {
    conditions.push('performed_at >= ?');
    bindings.push(options.since);
  }
  if (options.until) {
    conditions.push('performed_at <= ?');
    bindings.push(options.until);
  }
  if (options.exerciseTemplateId) {
    conditions.push('exercise_template_id = ?');
    bindings.push(options.exerciseTemplateId);
  }
  if (options.workoutId) {
    conditions.push('workout_id = ?');
    bindings.push(options.workoutId);
  }

  const result = await getDatabase()
    .prepare(
      `SELECT user_id, id, workout_id, exercise_template_id, exercise_title,
        exercise_index, set_index, set_type, weight_kg, reps, rpe,
        duration_seconds, distance_meters, exercise_notes, performed_at
       FROM hevy_sets WHERE ${conditions.join(' AND ')}
       ORDER BY performed_at DESC, exercise_index ASC, set_index ASC`,
    )
    .bind(...bindings)
    .all<SetRow>();
  return result.results.map(mapSet);
}

export async function listStoredTemplates(userId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT user_id, id, title, primary_muscle, secondary_muscles_json,
        equipment, is_custom, synced_at
       FROM hevy_templates WHERE user_id = ? ORDER BY title COLLATE NOCASE`,
    )
    .bind(userId)
    .all<TemplateRow>();
  return result.results.map(mapTemplate);
}

export async function countStoredWorkouts(userId: string) {
  const row = await getDatabase()
    .prepare(
      'SELECT COUNT(*) AS count FROM hevy_workouts WHERE user_id = ? AND deleted = 0',
    )
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function getHevySyncState(userId: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT user_id, last_event_since, full_sync_next_page,
        full_sync_page_count, full_sync_completed_at, templates_synced_at,
        last_sync_at, last_error
       FROM hevy_sync_state WHERE user_id = ?`,
    )
    .bind(userId)
    .first<SyncStateRow>();
  if (!row) return null;
  return {
    userId: row.user_id,
    lastEventSince: row.last_event_since,
    fullSyncNextPage: row.full_sync_next_page,
    fullSyncPageCount: row.full_sync_page_count,
    fullSyncCompletedAt: row.full_sync_completed_at,
    templatesSyncedAt: row.templates_synced_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
  } satisfies HevySyncState;
}

export async function replaceStoredWorkout(
  userId: string,
  workout: HevyWorkout,
  syncedAt = new Date().toISOString(),
) {
  const database = getDatabase();
  const bundle = serializeHevyWorkout(userId, workout, syncedAt);
  if (bundle.sets.length > 95) {
    throw new Error('A workout cannot contain more than 95 synchronized sets.');
  }

  const statements = [
    database
      .prepare(
        `INSERT INTO hevy_workouts (
          user_id, id, title, start_time, end_time, description,
          source_updated_at, raw_json, deleted, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          title = excluded.title,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          description = excluded.description,
          source_updated_at = excluded.source_updated_at,
          raw_json = excluded.raw_json,
          deleted = 0,
          synced_at = excluded.synced_at`,
      )
      .bind(
        bundle.workout.userId,
        bundle.workout.id,
        bundle.workout.title,
        bundle.workout.startTime,
        bundle.workout.endTime,
        bundle.workout.description,
        bundle.workout.sourceUpdatedAt,
        bundle.workout.rawJson,
        bundle.workout.deleted,
        bundle.workout.syncedAt,
      ),
    database
      .prepare('DELETE FROM hevy_sets WHERE user_id = ? AND workout_id = ?')
      .bind(userId, workout.id),
    ...bundle.sets.map((set) =>
      database
        .prepare(
          `INSERT INTO hevy_sets (
            user_id, id, workout_id, exercise_template_id, exercise_title,
            exercise_index, set_index, set_type, weight_kg, reps, rpe,
            duration_seconds, distance_meters, exercise_notes, performed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          set.userId,
          set.id,
          set.workoutId,
          set.exerciseTemplateId,
          set.exerciseTitle,
          set.exerciseIndex,
          set.setIndex,
          set.setType,
          set.weightKg,
          set.reps,
          set.rpe,
          set.durationSeconds,
          set.distanceMeters,
          set.exerciseNotes,
          set.performedAt,
        ),
    ),
  ];
  await database.batch(statements);
  return bundle;
}

export async function markStoredWorkoutDeleted(
  userId: string,
  workoutId: string,
  syncedAt = new Date().toISOString(),
) {
  const database = getDatabase();
  await database.batch([
    database
      .prepare(
        'UPDATE hevy_workouts SET deleted = 1, synced_at = ? WHERE user_id = ? AND id = ?',
      )
      .bind(syncedAt, userId, workoutId),
    database
      .prepare('DELETE FROM hevy_sets WHERE user_id = ? AND workout_id = ?')
      .bind(userId, workoutId),
  ]);
}

export async function upsertStoredTemplates(
  userId: string,
  templates: ExerciseTemplate[],
  syncedAt = new Date().toISOString(),
) {
  const database = getDatabase();
  const rows = templates.map((template) =>
    serializeHevyTemplate(userId, template, syncedAt),
  );
  for (let offset = 0; offset < rows.length; offset += 100) {
    await database.batch(
      rows.slice(offset, offset + 100).map((row) =>
        database
          .prepare(
            `INSERT INTO hevy_templates (
              user_id, id, title, primary_muscle, secondary_muscles_json,
              equipment, is_custom, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, id) DO UPDATE SET
              title = excluded.title,
              primary_muscle = excluded.primary_muscle,
              secondary_muscles_json = excluded.secondary_muscles_json,
              equipment = excluded.equipment,
              is_custom = excluded.is_custom,
              synced_at = excluded.synced_at`,
          )
          .bind(
            row.userId,
            row.id,
            row.title,
            row.primaryMuscle,
            row.secondaryMusclesJson,
            row.equipment,
            row.isCustom,
            row.syncedAt,
          ),
      ),
    );
  }
  return rows;
}

export async function saveHevySyncState(state: HevySyncState) {
  await getDatabase()
    .prepare(
      `INSERT INTO hevy_sync_state (
        user_id, last_event_since, full_sync_next_page, full_sync_page_count,
        full_sync_completed_at, templates_synced_at, last_sync_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        last_event_since = excluded.last_event_since,
        full_sync_next_page = excluded.full_sync_next_page,
        full_sync_page_count = excluded.full_sync_page_count,
        full_sync_completed_at = excluded.full_sync_completed_at,
        templates_synced_at = excluded.templates_synced_at,
        last_sync_at = excluded.last_sync_at,
        last_error = excluded.last_error`,
    )
    .bind(
      state.userId,
      state.lastEventSince,
      state.fullSyncNextPage,
      state.fullSyncPageCount,
      state.fullSyncCompletedAt,
      state.templatesSyncedAt,
      state.lastSyncAt,
      state.lastError,
    )
    .run();
  return state;
}
