import { getDatabase } from '../db';
import { extractWorkoutNotes, type WorkoutNote } from './notes';
import type { HevyWorkout } from './hevy-types';

export type NoteSearchResult = WorkoutNote & {
  rank: number;
};

function searchTerms(query: string) {
  const stopWords = new Set([
    'a',
    'about',
    'did',
    'do',
    'have',
    'i',
    'last',
    'mention',
    'my',
    'note',
    'notes',
    'when',
    'where',
    'what',
    'workout',
  ]);
  return [
    ...new Set(
      (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (term) => term.length >= 3 && !stopWords.has(term),
      ),
    ),
  ].slice(0, 8);
}

export function noteRowsForWorkout(userId: string, workout: HevyWorkout) {
  return extractWorkoutNotes(workout).map((note) => ({
    userId,
    workoutId: note.workoutId,
    exerciseTemplateId: note.exerciseTemplateId,
    exerciseTitle: note.exerciseTitle,
    workoutDate: note.workoutDate,
    workoutTitle: note.workoutTitle,
    content: note.text,
  }));
}

export async function searchStoredNotes(
  userId: string,
  query: string,
  limit = 8,
): Promise<NoteSearchResult[]> {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const match = terms.map((term) => `${term}*`).join(' OR ');
  const boundedLimit = Math.min(Math.max(limit, 1), 20);
  const result = await getDatabase()
    .prepare(
      `SELECT workout_id, exercise_template_id, exercise_title,
        workout_date, workout_title, content, bm25(hevy_notes_fts) AS rank
       FROM hevy_notes_fts
       WHERE user_id = ? AND hevy_notes_fts MATCH ?
       ORDER BY rank ASC, workout_date DESC
       LIMIT ?`,
    )
    .bind(userId, match, boundedLimit)
    .all<{
      workout_id: string;
      exercise_template_id: string | null;
      exercise_title: string | null;
      workout_date: string;
      workout_title: string;
      content: string;
      rank: number;
    }>();
  return result.results.map((row) => ({
    text: row.content,
    category: null,
    workoutId: row.workout_id,
    workoutDate: row.workout_date,
    workoutTitle: row.workout_title,
    exerciseTemplateId: row.exercise_template_id,
    exerciseTitle: row.exercise_title,
    rank: Number(row.rank ?? 0),
  }));
}
