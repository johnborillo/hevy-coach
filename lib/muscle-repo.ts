import { getDatabase } from '../db';
import { isMuscle, type Muscle, type MuscleOverride } from './muscles';

type MuscleOverrideRow = {
  exercise_template_id: string;
  primary_muscle: string;
  secondary_muscles_json: string;
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
    countsAs: Number(row.counts_as),
  };
}

export async function listMuscleOverrides(userId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT exercise_template_id, primary_muscle, secondary_muscles_json,
        counts_as
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
        secondary_muscles_json, counts_as, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, exercise_template_id) DO UPDATE SET
        primary_muscle = excluded.primary_muscle,
        secondary_muscles_json = excluded.secondary_muscles_json,
        counts_as = excluded.counts_as,
        updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      value.exerciseTemplateId,
      value.primaryMuscle,
      JSON.stringify(value.secondaryMuscles),
      value.countsAs,
      new Date().toISOString(),
    )
    .run();
  return value;
}
