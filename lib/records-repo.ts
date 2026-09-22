import { getDatabase } from '../db';
import type { PersonalRecord } from './records';

export async function savePersonalRecords(
  userId: string,
  records: PersonalRecord[],
  createdAt = new Date().toISOString(),
) {
  if (!records.length) return;
  const database = getDatabase();
  await database.batch(
    records.map((record) =>
      database
        .prepare(
          `INSERT INTO personal_records (
            id, user_id, key, template_id, slot_id, kind, rep_bucket,
            value, reps, load_kg, performed_at, workout_id,
            previous_value, previous_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            value = excluded.value,
            reps = excluded.reps,
            load_kg = excluded.load_kg,
            previous_value = excluded.previous_value,
            previous_at = excluded.previous_at`,
        )
        .bind(
          `${userId}:${record.id}`,
          userId,
          record.key,
          record.templateId,
          record.slotId,
          record.kind,
          record.repBucket,
          record.value,
          record.reps,
          record.loadKg,
          record.performedAt,
          record.workoutId,
          record.previousValue,
          record.previousAt,
          createdAt,
        ),
    ),
  );
}

export async function listPersonalRecords(userId: string, limit = 50) {
  const rows = await getDatabase()
    .prepare(
      `SELECT id, key, template_id, slot_id, kind, rep_bucket, value, reps,
        load_kg, performed_at, workout_id, previous_value, previous_at
       FROM personal_records
       WHERE user_id = ?
       ORDER BY performed_at DESC
       LIMIT ?`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 500))
    .all<{
      id: string;
      key: string;
      template_id: string;
      slot_id: string | null;
      kind: PersonalRecord['kind'];
      rep_bucket: string | null;
      value: number;
      reps: number;
      load_kg: number;
      performed_at: string;
      workout_id: string;
      previous_value: number | null;
      previous_at: string | null;
    }>();
  return rows.results.map(
    (row) =>
      ({
        id: row.id,
        key: row.key,
        scope: row.slot_id ? 'slot' : 'template',
        templateId: row.template_id,
        slotId: row.slot_id,
        subjectKey: row.slot_id ? `slot:${row.slot_id}` : `template:${row.template_id}`,
        exercise: row.template_id,
        kind: row.kind,
        repBucket: row.rep_bucket,
        value: row.value,
        reps: row.reps,
        loadKg: row.load_kg,
        performedAt: row.performed_at,
        workoutId: row.workout_id,
        previousValue: row.previous_value,
        previousAt: row.previous_at,
      }) satisfies PersonalRecord,
  );
}
