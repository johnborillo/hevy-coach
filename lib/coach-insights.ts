// Derived, date-aware signals that let the coach answer everyday questions
// ("how was today?", "should I train legs?", "what's next?") from the log
// instead of generic advice. Everything here is pure: callers pass the
// athlete's local "today" (see coach-clock.ts) and stored data.
import { addDays, daysBetween, weekdayOf } from './coach-clock';
import type { CalendarWorkout, DashboardData } from './hevy';
import type { NextSession } from './program-next';
import type { AthleteProfile, TrainingProgram } from './storage';
import type { TrainingBlock } from './training-block-repo';

type Workout = CalendarWorkout;
type Exercise = Workout['exercises'][number];

const LB_PER_KG = 2.2046226218;

function toDisplay(valueKg: number, profile: AthleteProfile) {
  const value = profile.weightUnit === 'kg' ? valueKg : valueKg * LB_PER_KG;
  return Math.round(value * 10) / 10;
}

function load(valueKg: number | null, profile: AthleteProfile) {
  if (valueKg == null || !Number.isFinite(valueKg)) return null;
  return `${toDisplay(valueKg, profile)} ${profile.weightUnit}`;
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function workingSets(exercise: Exercise) {
  return exercise.sets.filter((set) => set.type !== 'warmup');
}

/** Heaviest working set, tie-broken by reps; bodyweight work by reps. */
function topSet(exercise: Exercise) {
  return workingSets(exercise).reduce<Exercise['sets'][number] | null>(
    (best, set) => {
      if (!best) return set;
      const weight = set.weightKg ?? 0;
      const bestWeight = best.weightKg ?? 0;
      if (weight !== bestWeight) return weight > bestWeight ? set : best;
      return (set.reps ?? 0) > (best.reps ?? 0) ? set : best;
    },
    null,
  );
}

function exerciseVolumeKg(exercise: Exercise) {
  return workingSets(exercise).reduce(
    (total, set) => total + (set.weightKg ?? 0) * (set.reps ?? 0),
    0,
  );
}

function exerciseSummary(exercise: Exercise, profile: AthleteProfile) {
  const top = topSet(exercise);
  return {
    workingSets: workingSets(exercise).length,
    topSet: top
      ? {
          load: load(top.weightKg, profile),
          reps: top.reps,
          rpe: top.rpe,
        }
      : null,
    volume: load(exerciseVolumeKg(exercise), profile),
  };
}

/** Workouts are newest-first; return the latest one before `workout`. */
function previousMatching(
  workouts: Workout[],
  workout: Workout,
  predicate: (candidate: Workout) => boolean,
) {
  return (
    workouts.find(
      (candidate) =>
        candidate.id !== workout.id &&
        candidate.date <= workout.date &&
        (candidate.date < workout.date || candidate.time < workout.time) &&
        predicate(candidate),
    ) ?? null
  );
}

export type SessionComparison = ReturnType<typeof compareSession>;

/**
 * Compare a workout with the previous session of the same name and, per
 * exercise, with the last time that exercise was performed anywhere, so
 * rotating routines still get a like-for-like comparison.
 */
export function compareSession(
  workout: Workout,
  workouts: Workout[],
  records: DashboardData['records'],
  profile: AthleteProfile,
) {
  const sameName = previousMatching(
    workouts,
    workout,
    (candidate) => normalizeTitle(candidate.title) === normalizeTitle(workout.title),
  );
  const exercises = workout.exercises.map((exercise) => {
    const title = normalizeTitle(exercise.title);
    const previousWorkout = previousMatching(workouts, workout, (candidate) =>
      candidate.exercises.some((item) => normalizeTitle(item.title) === title),
    );
    const previousExercise = previousWorkout?.exercises.find(
      (item) => normalizeTitle(item.title) === title,
    );
    const current = topSet(exercise);
    const before = previousExercise ? topSet(previousExercise) : null;
    return {
      exercise: exercise.title,
      thisSession: exerciseSummary(exercise, profile),
      previous: previousExercise && previousWorkout
        ? {
            workoutId: previousWorkout.id,
            date: previousWorkout.date,
            ...exerciseSummary(previousExercise, profile),
          }
        : null,
      topSetChange:
        current && before
          ? {
              load:
                current.weightKg != null && before.weightKg != null
                  ? load(current.weightKg - before.weightKg, profile)
                  : null,
              reps:
                current.reps != null && before.reps != null
                  ? current.reps - before.reps
                  : null,
            }
          : null,
    };
  });
  const exerciseTitles = new Set(
    workout.exercises.map((exercise) => normalizeTitle(exercise.title)),
  );
  return {
    workoutId: workout.id,
    date: workout.date,
    title: workout.title,
    previousSameNamedWorkout: sameName
      ? {
          workoutId: sameName.id,
          date: sameName.date,
          daysEarlier: daysBetween(sameName.date, workout.date),
          durationMinutes: sameName.durationMinutes,
          workingSets: sameName.workingSets,
          volume: load(sameName.volumeKg, profile),
        }
      : null,
    thisSessionTotals: {
      durationMinutes: workout.durationMinutes,
      workingSets: workout.workingSets,
      volume: load(workout.volumeKg, profile),
    },
    exercises,
    personalRecords: records
      .filter(
        (record) =>
          record.date === workout.date &&
          exerciseTitles.has(normalizeTitle(record.exercise)),
      )
      .map((record) => ({
        exercise: record.exercise,
        kind: record.kind,
        load: load(record.weightKg, profile),
        reps: record.reps,
        previousDate: record.previousDate,
      })),
  };
}

/** Workout ids a comparison cites, so they can join the verified log. */
export function comparisonWorkoutIds(comparison: SessionComparison) {
  return [
    comparison.previousSameNamedWorkout?.workoutId,
    ...comparison.exercises.map((exercise) => exercise.previous?.workoutId),
  ].filter((id): id is string => Boolean(id));
}

/** Days since each muscle group's last direct working sets. */
export function muscleRecency(workouts: Workout[], today: string) {
  const weekAgo = addDays(today, -6);
  const byMuscle = new Map<
    string,
    { lastTrained: string; workingSetsLast7Days: number }
  >();
  for (const workout of workouts) {
    if (workout.date > today) continue;
    for (const exercise of workout.exercises) {
      const sets = workingSets(exercise).length;
      if (!exercise.muscle || !sets) continue;
      const entry = byMuscle.get(exercise.muscle) ?? {
        lastTrained: workout.date,
        workingSetsLast7Days: 0,
      };
      if (workout.date > entry.lastTrained) entry.lastTrained = workout.date;
      if (workout.date >= weekAgo) entry.workingSetsLast7Days += sets;
      byMuscle.set(exercise.muscle, entry);
    }
  }
  return [...byMuscle.entries()]
    .map(([muscle, entry]) => ({
      muscle,
      lastTrained: entry.lastTrained,
      daysSince: daysBetween(entry.lastTrained, today),
      workingSetsLast7Days: entry.workingSetsLast7Days,
    }))
    .sort((a, b) => a.daysSince - b.daysSince || a.muscle.localeCompare(b.muscle));
}

/** Monday-based week, matching the weekly review. */
export function weekProgress(
  workouts: Workout[],
  today: string,
  targetSessions: number,
) {
  const offset = (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const).indexOf(
    weekdayOf(today) as 'Monday',
  );
  const weekStart = addDays(today, -offset);
  const sessions = workouts
    .filter((workout) => workout.date >= weekStart && workout.date <= today)
    .map((workout) => ({
      workoutId: workout.id,
      date: workout.date,
      weekday: weekdayOf(workout.date),
      title: workout.title,
    }))
    .reverse();
  return {
    weekStart,
    sessionsDone: sessions.length,
    targetSessions,
    sessionsRemaining: Math.max(0, targetSessions - sessions.length),
    daysLeftIncludingToday: 7 - offset,
    sessions,
  };
}

/**
 * The program day after the most recent workout that matches a day by
 * name; day 1 when nothing matches yet.
 */
export function nextProgramDayIndex(program: TrainingProgram, workouts: Workout[]) {
  if (!program.days.length) return 0;
  const titles = program.days.map((day) => normalizeTitle(day.title));
  for (const workout of workouts) {
    const title = normalizeTitle(workout.title);
    const index = titles.findIndex(
      (day) => day && (title === day || title.includes(day) || day.includes(title)),
    );
    if (index >= 0) return (index + 1) % program.days.length;
  }
  return 0;
}

export function plannedSession(
  program: TrainingProgram | null,
  session: NextSession | null,
) {
  if (!program || !session) return null;
  return {
    program: program.title,
    day: session.dayIndex + 1,
    of: program.days.length,
    title: session.day.title,
    focus: session.day.focus,
    exercises: session.exercises.map((exercise) => ({
      name: exercise.name,
      sets: exercise.sets,
      reps: exercise.reps,
      effort: exercise.effort,
      load: exercise.load,
    })),
  };
}

export function blockProgress(block: TrainingBlock | null | undefined, today: string) {
  if (!block) return null;
  const elapsed = daysBetween(block.startsAt.slice(0, 10), today);
  const totalDays = block.endsAt
    ? daysBetween(block.startsAt.slice(0, 10), block.endsAt.slice(0, 10)) + 1
    : null;
  const daysRemaining =
    block.endsAt == null ? null : daysBetween(today, block.endsAt.slice(0, 10));
  return {
    name: block.name,
    kind: block.kind,
    startsAt: block.startsAt.slice(0, 10),
    endsAt: block.endsAt?.slice(0, 10) ?? null,
    started: elapsed >= 0,
    week: elapsed >= 0 ? Math.floor(elapsed / 7) + 1 : null,
    totalWeeks: totalDays == null ? null : Math.ceil(totalDays / 7),
    daysRemaining,
    endsWithinAWeek: daysRemaining != null && daysRemaining >= 0 && daysRemaining < 7,
  };
}
