import { getDatabase } from '@/db';
import type { WeeklyReview } from './findings';

function parseReview(value: string): WeeklyReview | null {
  try {
    const parsed = JSON.parse(value) as WeeklyReview;
    if (!parsed.weekStart || !parsed.summary || !Array.isArray(parsed.watch)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getWeeklyReview(userId: string, weekStart: string) {
  const row = await getDatabase()
    .prepare(
      `SELECT content_json FROM weekly_reviews
       WHERE user_id = ? AND week_start = ? LIMIT 1`,
    )
    .bind(userId, weekStart)
    .first<{ content_json: string }>();
  return row ? parseReview(row.content_json) : null;
}

export async function listWeeklyReviews(userId: string, limit = 12) {
  const rows = await getDatabase()
    .prepare(
      `SELECT content_json FROM weekly_reviews
       WHERE user_id = ? ORDER BY week_start DESC LIMIT ?`,
    )
    .bind(userId, Math.min(Math.max(limit, 1), 52))
    .all<{ content_json: string }>();
  return rows.results
    .map((row) => parseReview(row.content_json))
    .filter((review): review is WeeklyReview => review !== null);
}

export async function saveWeeklyReview(userId: string, review: WeeklyReview) {
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(
      `INSERT INTO weekly_reviews (id, user_id, week_start, content_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, week_start) DO UPDATE SET
         content_json = excluded.content_json,
         created_at = excluded.created_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      review.weekStart,
      JSON.stringify(review),
      now,
    )
    .run();
  return review;
}
