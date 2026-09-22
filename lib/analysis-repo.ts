import { getDatabase } from '../db';
import {
  DASHBOARD_SNAPSHOT_VERSION,
  snapshotContent,
  stableFingerprint,
} from './analysis-cache';
import type { DashboardData } from './hevy';

export type DerivationState = {
  fingerprint: string;
  derivedAt: string;
  version: number;
};

type FingerprintRow = Record<string, string | number | null>;

export async function getDashboardSnapshot(userId: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT content_json FROM dashboard_snapshots
       WHERE user_id = ? AND version = ?`,
    )
    .bind(userId, DASHBOARD_SNAPSHOT_VERSION)
    .first<{ content_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.content_json) as DashboardData;
  } catch {
    return null;
  }
}

export async function saveDashboardSnapshot(
  userId: string,
  dashboard: DashboardData,
  derivedAt: string,
) {
  await getDatabase()
    .prepare(
      `INSERT INTO dashboard_snapshots
        (user_id, content_json, derived_at, version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         content_json = excluded.content_json,
         derived_at = excluded.derived_at,
         version = excluded.version`,
    )
    .bind(
      userId,
      JSON.stringify(snapshotContent(dashboard)),
      derivedAt,
      DASHBOARD_SNAPSHOT_VERSION,
    )
    .run();
}

export async function deleteDashboardSnapshot(userId: string) {
  await getDatabase()
    .prepare('DELETE FROM dashboard_snapshots WHERE user_id = ?')
    .bind(userId)
    .run();
}

export async function getDerivationState(userId: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT fingerprint, derived_at, version FROM derivation_state
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{
      fingerprint: string;
      derived_at: string;
      version: number;
    }>();
  return row
    ? ({
        fingerprint: row.fingerprint,
        derivedAt: row.derived_at,
        version: row.version,
      } satisfies DerivationState)
    : null;
}

export async function saveDerivationState(
  userId: string,
  state: DerivationState,
) {
  await getDatabase()
    .prepare(
      `INSERT INTO derivation_state (user_id, fingerprint, derived_at, version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         derived_at = excluded.derived_at,
         version = excluded.version`,
    )
    .bind(userId, state.fingerprint, state.derivedAt, state.version)
    .run();
}

export async function analysisFingerprint(userId: string) {
  const database = getDatabase();
  const [training, profile, overrides, slots, blocks, weights] =
    await Promise.all([
      database
        .prepare(
          `SELECT COUNT(*) AS workout_count,
            MAX(source_updated_at) AS workout_source_updated_at,
            MAX(synced_at) AS workout_synced_at,
            (SELECT COUNT(*) FROM hevy_templates WHERE user_id = ?) AS template_count,
            (SELECT MAX(synced_at) FROM hevy_templates WHERE user_id = ?) AS template_synced_at
           FROM hevy_workouts WHERE user_id = ? AND deleted = 0`,
        )
        .bind(userId, userId, userId)
        .first<FingerprintRow>(),
      database
        .prepare(
          `SELECT display_name, biological_sex, age, height_cm, weight_kg,
            weight_unit, height_unit, experience, primary_goal, target_date,
            days_per_week, minutes_per_session, equipment, limitations,
            preferences, phase, phase_started_at, daily_calories,
            protein_grams, sleep_hours_typical, dropset_weight,
            load_increments_json, timezone, updated_at
           FROM athlete_profiles WHERE user_id = ?`,
        )
        .bind(userId)
        .all<FingerprintRow>(),
      database
        .prepare(
          `SELECT exercise_template_id, primary_muscle,
            secondary_muscles_json, slot_id, counts_as, updated_at
           FROM muscle_overrides WHERE user_id = ?
           ORDER BY exercise_template_id`,
        )
        .bind(userId)
        .all<FingerprintRow>(),
      database
        .prepare(
          `SELECT id, name, primary_muscle, pattern FROM exercise_slots
           WHERE user_id = ? ORDER BY id`,
        )
        .bind(userId)
        .all<FingerprintRow>(),
      database
        .prepare(
          `SELECT id, name, kind, starts_at, ends_at, program_id
           FROM training_blocks WHERE user_id = ? ORDER BY id`,
        )
        .bind(userId)
        .all<FingerprintRow>(),
      database
        .prepare(
          `SELECT COUNT(*) AS weight_count, MAX(measured_at) AS latest_weight,
            MAX(id) AS latest_weight_id, SUM(weight_kg) AS weight_checksum
           FROM body_weights WHERE user_id = ?`,
        )
        .bind(userId)
        .first<FingerprintRow>(),
    ]);

  return stableFingerprint({
    version: DASHBOARD_SNAPSHOT_VERSION,
    training: training ?? {},
    profile: profile.results,
    overrides: overrides.results,
    slots: slots.results,
    blocks: blocks.results,
    weights: weights ?? {},
  });
}
