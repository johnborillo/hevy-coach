import { getDatabase } from '../db';
import type { ProgressionState } from './progression';

type ProgressionStateRow = {
  state_json: string;
};

export async function listProgressionStates(userId: string) {
  const result = await getDatabase()
    .prepare(
      `SELECT state_json FROM progression_states
       WHERE user_id = ? ORDER BY computed_at DESC`,
    )
    .bind(userId)
    .all<ProgressionStateRow>();

  return result.results.flatMap((row) => {
    try {
      return [JSON.parse(row.state_json) as ProgressionState];
    } catch {
      return [];
    }
  });
}

export async function saveProgressionStates(
  userId: string,
  states: ProgressionState[],
  analysisVersion: number,
  computedAt = new Date().toISOString(),
) {
  if (!states.length) return;
  const database = getDatabase();
  await database.batch(
    states.map((state) =>
      database
        .prepare(
          `INSERT INTO progression_states (
            user_id, slot_or_template_id, computed_at, analysis_version,
            state_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, slot_or_template_id) DO UPDATE SET
            computed_at = excluded.computed_at,
            analysis_version = excluded.analysis_version,
            state_json = excluded.state_json`,
        )
        .bind(
          userId,
          state.slotId ?? state.exerciseTemplateId,
          computedAt,
          analysisVersion,
          JSON.stringify(state),
        ),
    ),
  );
}
