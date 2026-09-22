import { getDatabase } from '../db';
import { isMuscle, type Muscle, type MuscleOverride } from './muscles';

type MuscleOverrideRow = {
  exercise_template_id: string;
  primary_muscle: string;
  secondary_muscles_json: string;
  slot_id: string | null;
  counts_as: number;
};

function parseSecondaryMuscles(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((muscle): muscle is Muscle => isMuscle(muscle))
      : [];
  } catch {
    return [];
  }
}

function mapOverride(row: MuscleOverrideRow): MuscleOverride {
  return {
    exerciseTemplateId: row.exercise_template_id,
    primaryMuscle: isMuscle(row.primary_muscle) ? row.primary_muscle : 'other',
    secondaryMuscles: parseSecondaryMuscles(row.secondary_muscles_json),
    slotId: row.slot_id,
    countsAs: Number(row.counts_as),
  };
}

export async function listMuscleOverrides(userId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT exercise_template_id, primary_muscle, secondary_muscles_json,
        slot_id, counts_as
       FROM muscle_overrides WHERE user_id = ?`,
    )
    .bind(userId)
    .all<MuscleOverrideRow>();
  return result.results.map(mapOverride);
}

export async function saveMuscleOverride(
  userId: string,
  override: MuscleOverride,
) {
  const template = await getDatabase()
    .prepare('SELECT id FROM hevy_templates WHERE user_id = ? AND id = ?')
    .bind(userId, override.exerciseTemplateId)
    .first<{ id: string }>();
  if (!template) throw new Error('Exercise template not found.');

  const value = {
    ...override,
    secondaryMuscles: [...new Set(override.secondaryMuscles)].filter(
      (muscle) => muscle !== override.primaryMuscle,
    ),
    countsAs: Math.min(Math.max(override.countsAs, 0), 2),
  };
  await getDatabase()
    .prepare(
      `INSERT INTO muscle_overrides (
        user_id, exercise_template_id, primary_muscle,
        secondary_muscles_json, slot_id, counts_as, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, exercise_template_id) DO UPDATE SET
        primary_muscle = excluded.primary_muscle,
        secondary_muscles_json = excluded.secondary_muscles_json,
        slot_id = COALESCE(excluded.slot_id, muscle_overrides.slot_id),
        counts_as = excluded.counts_as,
        updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      value.exerciseTemplateId,
      value.primaryMuscle,
      JSON.stringify(value.secondaryMuscles),
      value.slotId ?? null,
      value.countsAs,
      new Date().toISOString(),
    )
    .run();
  return value;
}

export async function setExerciseSlot(
  userId: string,
  exerciseTemplateId: string,
  slotId: string | null,
) {
  const database = getDatabase();
  const slot = slotId
    ? await database
        .prepare('SELECT id FROM exercise_slots WHERE user_id = ? AND id = ?')
        .bind(userId, slotId)
        .first<{ id: string }>()
    : { id: null };
  if (slotId && !slot) throw new Error('Exercise slot not found.');
  const existing = await database
    .prepare(
      `SELECT exercise_template_id FROM muscle_overrides
       WHERE user_id = ? AND exercise_template_id = ?`,
    )
    .bind(userId, exerciseTemplateId)
    .first<{ exercise_template_id: string }>();
  if (existing) {
    await database
      .prepare(
        `UPDATE muscle_overrides SET slot_id = ?, updated_at = ?
         WHERE user_id = ? AND exercise_template_id = ?`,
      )
      .bind(slotId, new Date().toISOString(), userId, exerciseTemplateId)
      .run();
    return;
  }

  const template = await database
    .prepare(
      `SELECT id, title, primary_muscle, secondary_muscles_json, is_custom
       FROM hevy_templates WHERE user_id = ? AND id = ?`,
    )
    .bind(userId, exerciseTemplateId)
    .first<{
      id: string;
      title: string;
      primary_muscle: string | null;
      secondary_muscles_json: string;
      is_custom: number;
    }>();
  if (!template) throw new Error('Exercise template not found.');
  const { resolveMuscles } = await import('./muscles');
  const secondary = parseSecondaryMuscles(template.secondary_muscles_json);
  const resolved = resolveMuscles({
    id: template.id,
    title: template.title,
    primary_muscle_group: template.primary_muscle ?? undefined,
    secondary_muscle_groups: secondary,
    is_custom: Boolean(template.is_custom),
  });
  await database
    .prepare(
      `INSERT INTO muscle_overrides (
        user_id, exercise_template_id, primary_muscle,
        secondary_muscles_json, slot_id, counts_as, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      exerciseTemplateId,
      resolved.primary,
      JSON.stringify(resolved.secondary),
      slotId,
      1,
      new Date().toISOString(),
    )
    .run();
}
