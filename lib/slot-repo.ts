import { getDatabase } from '../db';
import { isMuscle, type Muscle } from './muscles';
import { SLOT_PATTERNS, type ExerciseSlot, type SlotPattern } from './slots';

type SlotRow = {
  id: string;
  user_id: string;
  name: string;
  primary_muscle: string;
  pattern: string | null;
};

function mapSlot(row: SlotRow, templateIds: string[] = []): ExerciseSlot {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    primaryMuscle: isMuscle(row.primary_muscle) ? row.primary_muscle : 'other',
    pattern: SLOT_PATTERNS.includes(row.pattern as SlotPattern)
      ? (row.pattern as SlotPattern)
      : null,
    templateIds,
  };
}

export async function listExerciseSlots(userId: string) {
  const database = getDatabase();
  const [slots, memberships] = await Promise.all([
    database
      .prepare(
        `SELECT id, user_id, name, primary_muscle, pattern
         FROM exercise_slots WHERE user_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .bind(userId)
      .all<SlotRow>(),
    database
      .prepare(
        `SELECT slot_id, exercise_template_id FROM muscle_overrides
         WHERE user_id = ? AND slot_id IS NOT NULL`,
      )
      .bind(userId)
      .all<{ slot_id: string; exercise_template_id: string }>(),
  ]);
  const templateIdsBySlot = new Map<string, string[]>();
  for (const membership of memberships.results) {
    const ids = templateIdsBySlot.get(membership.slot_id) ?? [];
    ids.push(membership.exercise_template_id);
    templateIdsBySlot.set(membership.slot_id, ids);
  }
  return slots.results.map((row) =>
    mapSlot(row, templateIdsBySlot.get(row.id) ?? []),
  );
}

export async function createExerciseSlot(
  userId: string,
  input: { name: string; primaryMuscle: Muscle; pattern: SlotPattern | null },
) {
  const id = crypto.randomUUID();
  await getDatabase()
    .prepare(
      `INSERT INTO exercise_slots (id, user_id, name, primary_muscle, pattern)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, input.name.trim(), input.primaryMuscle, input.pattern)
    .run();
  return { id, userId, ...input, templateIds: [] } satisfies ExerciseSlot;
}

export async function updateExerciseSlot(
  userId: string,
  slotId: string,
  input: { name?: string },
) {
  if (!input.name?.trim()) throw new Error('A slot name is required.');
  const result = await getDatabase()
    .prepare(`UPDATE exercise_slots SET name = ? WHERE user_id = ? AND id = ?`)
    .bind(input.name.trim(), userId, slotId)
    .run();
  if (!result.meta.changes) throw new Error('Exercise slot not found.');
}

export async function deleteExerciseSlot(userId: string, slotId: string) {
  const database = getDatabase();
  await database.batch([
    database
      .prepare(
        `UPDATE muscle_overrides SET slot_id = NULL, updated_at = ?
         WHERE user_id = ? AND slot_id = ?`,
      )
      .bind(new Date().toISOString(), userId, slotId),
    database
      .prepare('DELETE FROM exercise_slots WHERE user_id = ? AND id = ?')
      .bind(userId, slotId),
  ]);
}
