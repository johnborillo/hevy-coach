import { getDatabase } from '@/db';
import type { BodyWeightPoint } from './body-weight';

export { summarizeBodyWeight } from './body-weight';
export type { BodyWeightPoint } from './body-weight';

export async function saveBodyWeight(
  userId: string,
  weightKg: number,
  measuredAt = new Date().toISOString(),
  source: BodyWeightPoint['source'] = 'manual',
) {
  const id = crypto.randomUUID();
  await getDatabase()
    .prepare(
      `INSERT INTO body_weights (id, user_id, measured_at, weight_kg, source)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, measuredAt, weightKg, source)
    .run();
  return { id, measuredAt, weightKg, source } satisfies BodyWeightPoint;
}

export async function upsertHevyBodyWeights(
  userId: string,
  points: Array<{ measuredAt: string; weightKg: number }>,
) {
  const database = getDatabase();
  for (const point of points) {
    const existing = await database
      .prepare(
        `SELECT id FROM body_weights
         WHERE user_id = ? AND measured_at = ? AND source = 'hevy' LIMIT 1`,
      )
      .bind(userId, point.measuredAt)
      .first<{ id: string }>();
    if (existing) {
      await database
        .prepare(
          `UPDATE body_weights SET weight_kg = ?
           WHERE user_id = ? AND id = ?`,
        )
        .bind(point.weightKg, userId, existing.id)
        .run();
      continue;
    }
    await database
      .prepare(
        `INSERT INTO body_weights (id, user_id, measured_at, weight_kg, source)
         VALUES (?, ?, ?, ?, 'hevy')`,
      )
      .bind(crypto.randomUUID(), userId, point.measuredAt, point.weightKg)
      .run();
  }
}

export async function listBodyWeights(userId: string, limit = 120) {
  const rows = await getDatabase()
    .prepare(
      `SELECT id, measured_at, weight_kg, source
       FROM body_weights WHERE user_id = ?
       ORDER BY measured_at DESC LIMIT ?`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 500))
    .all<{
      id: string;
      measured_at: string;
      weight_kg: number;
      source: 'hevy' | 'manual';
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    measuredAt: row.measured_at,
    weightKg: row.weight_kg,
    source: row.source,
  }));
}
