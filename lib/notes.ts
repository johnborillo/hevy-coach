import type { Finding } from './findings';
import type { HevyWorkout } from './hevy-types';

export type NoteCategory = 'pain' | 'recovery' | 'time' | 'intent';

export type WorkoutNote = {
  text: string;
  category: NoteCategory | null;
  workoutId: string;
  workoutDate: string;
  workoutTitle: string;
  exerciseTemplateId: string | null;
  exerciseTitle: string | null;
};

const NOTE_PATTERNS: Array<{ category: NoteCategory; pattern: RegExp }> = [
  {
    category: 'pain',
    pattern: /\b(?:pain|pinch|pinched|tweak|sharp|sore joint|clicking)\b/i,
  },
  {
    category: 'recovery',
    pattern: /\b(?:slept|tired|exhausted|stress|stressed|hungover)\b/i,
  },
  {
    category: 'time',
    pattern: /\b(?:rushed|short on time|cut short)\b/i,
  },
  {
    category: 'intent',
    pattern: /\b(?:deload|light day|technique day)\b/i,
  },
];

const NOTE_RECOMMENDATIONS: Record<NoteCategory, string> = {
  pain:
    'Athlete reported discomfort; consider a joint-friendlier variation and seek assessment if it persists.',
  recovery:
    'Treat this as recovery context when judging performance; keep the next exposure conservative if it repeats.',
  time:
    'Treat this as a time-constrained session when comparing volume or progression with a normal workout.',
  intent:
    'Treat this as an intentional lower-stress exposure rather than a normal progression test.',
};

function clean(value: string | null | undefined) {
  return value?.trim() ?? '';
}

export function noteCategory(text: string): NoteCategory | null {
  return NOTE_PATTERNS.find((item) => item.pattern.test(text))?.category ?? null;
}

function weekStartFor(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString();
}

export function extractWorkoutNotes(workout: HevyWorkout): WorkoutNote[] {
  const workoutDate = workout.start_time.slice(0, 10);
  const notes: WorkoutNote[] = [];
  const description = clean(workout.description);
  if (description) {
    notes.push({
      text: description,
      category: noteCategory(description),
      workoutId: workout.id,
      workoutDate,
      workoutTitle: workout.title,
      exerciseTemplateId: null,
      exerciseTitle: null,
    });
  }
  for (const exercise of workout.exercises) {
    const text = clean(exercise.notes);
    if (!text) continue;
    notes.push({
      text,
      category: noteCategory(text),
      workoutId: workout.id,
      workoutDate,
      workoutTitle: workout.title,
      exerciseTemplateId: exercise.exercise_template_id,
      exerciseTitle: exercise.title,
    });
  }
  return notes;
}

export function flagNotes(
  workout: HevyWorkout,
  weekStart = weekStartFor(workout.start_time),
): Finding[] {
  return extractWorkoutNotes(workout).flatMap((note, index) => {
    if (!note.category) return [];
    const exerciseLabel = note.exerciseTitle ?? 'Workout note';
    const subjectKey = `${note.workoutId}:${note.exerciseTemplateId ?? 'workout'}:${index}`;
    return [
      {
        id: `NOTE_FLAGGED:${subjectKey}:${note.category}`,
        kind: 'NOTE_FLAGGED',
        severity: note.category === 'pain' ? 'watch' : 'info',
        subject: {
          type: note.exerciseTemplateId ? 'exercise' : 'athlete',
          key: subjectKey,
          label: exerciseLabel,
        },
        headline: `${exerciseLabel} note flagged: “${note.text}”`,
        evidence: {
          note: note.text,
          category: note.category,
          workoutDate: note.workoutDate,
          workoutTitle: note.workoutTitle,
          ...(note.exerciseTemplateId
            ? { exerciseTemplateId: note.exerciseTemplateId }
            : {}),
        },
        recommendation: NOTE_RECOMMENDATIONS[note.category],
        citations: [note.workoutId],
        firstSeenWeek: weekStart,
      } satisfies Finding,
    ];
  });
}

export function painSuppressedExerciseTemplateIds(
  workouts: HevyWorkout[],
): string[] {
  const sorted = [...workouts].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
  const result = new Set<string>();
  for (const noteWorkout of sorted) {
    const painTemplates = extractWorkoutNotes(noteWorkout)
      .filter((note) => note.category === 'pain' && note.exerciseTemplateId)
      .map((note) => note.exerciseTemplateId as string);
    if (!painTemplates.length) continue;
    for (const templateId of painTemplates) {
      const laterExposures = sorted.filter(
        (workout) =>
          new Date(workout.start_time).getTime() >
            new Date(noteWorkout.start_time).getTime() &&
          workout.exercises.some(
            (exercise) => exercise.exercise_template_id === templateId,
          ),
      ).length;
      if (laterExposures <= 2) result.add(templateId);
    }
  }
  return [...result];
}

export function noteRecommendation(category: NoteCategory) {
  return NOTE_RECOMMENDATIONS[category];
}
