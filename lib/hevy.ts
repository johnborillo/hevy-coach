import {
  createAnalysisMetadata,
  type AnalysisMetadata,
} from './analysis-contracts';
import type {
  ExerciseTemplate,
  HevySet,
  HevyWorkout,
} from './hevy-types';
import { deserializeHevyTemplate } from './hevy-store';

export type TrendPoint = { date: string; value: number; label: string };

export type ExerciseOption = {
  name: string;
  muscle: string;
  sets: number;
  reps: number | null;
  weightKg: number | null;
  note: string;
};

export type WorkoutSetLog = {
  type: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
};

export type CalendarWorkout = {
  id: string;
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  workingSets: number;
  volumeKg: number;
  exercises: Array<{
    title: string;
    muscle: string;
    sets: WorkoutSetLog[];
  }>;
};

export type MuscleDistribution = {
  name: string;
  sets: number;
  previousSets: number;
  volumeKg: number;
};

export type MuscleWindow = '7' | '14' | '30';

export type DashboardData = {
  analysis: AnalysisMetadata;
  connected: boolean;
  sourceLabel: string;
  syncMessage: string;
  athleteName: string;
  lastWorkout: string;
  stats: {
    sessions30d: number;
    workingSets7d: number;
    hours30d: number;
    activeWeeks: number;
    totalVolume30dKg: number;
    avgSessionMinutes: number;
    consistencyPercent: number;
    volumeChangePercent: number;
  };
  muscles: MuscleDistribution[];
  muscleWindows: Record<MuscleWindow, MuscleDistribution[]>;
  trend: { exercise: string; change: number; points: TrendPoint[] };
  strengthTrends: Array<{
    exercise: string;
    change: number;
    bestKg: number;
    points: TrendPoint[];
  }>;
  workloadWeeks: Array<{
    label: string;
    sets: number;
    volumeKg: number;
    sessions: number;
  }>;
  records: Array<{
    exercise: string;
    date: string;
    valueKg: number;
    reps: number;
    weightKg: number;
  }>;
  exerciseStats: Array<{
    exercise: string;
    muscle: string;
    sessions: number;
    workingSets: number;
    volumeKg: number;
    bestE1rmKg: number;
    change: number;
  }>;
  recentWorkouts: Array<{
    title: string;
    date: string;
    duration: string;
    exercises: number;
    workingSets: number;
    volumeKg: number;
  }>;
  calendarWorkouts: CalendarWorkout[];
  exerciseOptions: ExerciseOption[];
  weeklyReview: {
    label: string;
    wins: string[];
    watch: string[];
    nextSteps: string[];
  };
  insights: { plateau: string; return: string; progress: string };
};

const DAY = 86_400_000;

function isWorkingSet(set: HevySet) {
  return set.type !== "warmup";
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function daysAgo(iso: string, nowMs = Date.now()) {
  return (nowMs - new Date(iso).getTime()) / DAY;
}

function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function durationMinutes(workout: HevyWorkout) {
  return Math.max(0, (new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 60_000);
}

function estimatedOneRepMax(set: HevySet) {
  if (!set.weight_kg || !set.reps || set.reps > 15) return null;
  return set.weight_kg * (1 + set.reps / 30);
}

function setVolume(set: HevySet) {
  return isWorkingSet(set) && set.weight_kg && set.reps ? set.weight_kg * set.reps : 0;
}

function workoutVolume(workout: HevyWorkout) {
  return workout.exercises.flatMap((exercise) => exercise.sets).reduce((sum, set) => sum + setVolume(set), 0);
}

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - day);
  return copy;
}

export function analyzeWorkoutHistory(
  workouts: HevyWorkout[],
  templates: ExerciseTemplate[],
  athleteName: string,
  now = new Date(),
): DashboardData {
  const nowMs = now.getTime();
  const sorted = [...workouts].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const recent30 = sorted.filter((workout) => daysAgo(workout.start_time, nowMs) <= 30);
  const recent7 = sorted.filter((workout) => daysAgo(workout.start_time, nowMs) <= 7);
  const previous7 = sorted.filter((workout) => daysAgo(workout.start_time, nowMs) > 7 && daysAgo(workout.start_time, nowMs) <= 14);
  const countSets = (items: HevyWorkout[]) =>
    items
      .flatMap((workout) => workout.exercises)
      .flatMap((exercise) => exercise.sets)
      .filter(isWorkingSet).length;
  const totalVolume = (items: HevyWorkout[]) => items.reduce((sum, workout) => sum + workoutVolume(workout), 0);
  const workingSets7d = countSets(recent7);
  const volume7d = totalVolume(recent7);
  const previousVolume7d = totalVolume(previous7);
  const totalMinutes = recent30.reduce((sum, workout) => sum + durationMinutes(workout), 0);

  const muscleDistribution = (windowDays: number) => {
    const current = new Map<string, { sets: number; volumeKg: number }>();
    const previous = new Map<string, number>();

    for (const workout of sorted) {
      const age = daysAgo(workout.start_time, nowMs);
      const inCurrentWindow = age >= 0 && age <= windowDays;
      const inPreviousWindow = age > windowDays && age <= windowDays * 2;
      if (!inCurrentWindow && !inPreviousWindow) continue;

      for (const exercise of workout.exercises) {
        const muscle = templateMap.get(exercise.exercise_template_id)?.primary_muscle_group ?? "other";
        const sets = exercise.sets.filter(isWorkingSet);
        if (inCurrentWindow) {
          const value = current.get(muscle) ?? { sets: 0, volumeKg: 0 };
          value.sets += sets.length;
          value.volumeKg += sets.reduce((sum, set) => sum + setVolume(set), 0);
          current.set(muscle, value);
        } else {
          previous.set(muscle, (previous.get(muscle) ?? 0) + sets.length);
        }
      }
    }

    return [...current.entries()]
      .map(([name, value]) => ({
        name: titleCase(name),
        sets: value.sets,
        previousSets: previous.get(name) ?? 0,
        volumeKg: Math.round(value.volumeKg),
      }))
      .sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name))
      .slice(0, 10);
  };

  const muscleWindows: Record<MuscleWindow, MuscleDistribution[]> = {
    '7': muscleDistribution(7),
    '14': muscleDistribution(14),
    '30': muscleDistribution(30),
  };
  const muscles = muscleWindows['7'];

  const histories = new Map<
    string,
    Array<{
      date: string;
      value: number;
      title: string;
      reps: number;
      weightKg: number;
    }>
  >();
  const exerciseTotals = new Map<string, { title: string; sessions: number; sets: number; volumeKg: number }>();
  for (const workout of sorted) {
    for (const exercise of workout.exercises) {
      const working = exercise.sets.filter(isWorkingSet);
      const total = exerciseTotals.get(exercise.exercise_template_id) ?? {
        title: exercise.title,
        sessions: 0,
        sets: 0,
        volumeKg: 0,
      };
      total.sessions += 1;
      total.sets += working.length;
      total.volumeKg += working.reduce((sum, set) => sum + setVolume(set), 0);
      exerciseTotals.set(exercise.exercise_template_id, total);
      const candidates = working
        .map((set) => ({ set, value: estimatedOneRepMax(set) }))
        .filter((item) => item.value !== null && item.set.reps && item.set.weight_kg)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      if (!candidates.length) continue;
      const best = candidates[0];
      const history = histories.get(exercise.exercise_template_id) ?? [];
      history.push({
        date: workout.start_time,
        value: best.value as number,
        title: exercise.title,
        reps: best.set.reps as number,
        weightKg: best.set.weight_kg as number,
      });
      histories.set(exercise.exercise_template_id, history);
    }
  }

  const strengthTrends = [...histories.values()]
    .sort((a, b) => b.length - a.length)
    .map((history) => {
      const chronological = [...history].reverse().slice(-8);
      const points = chronological.map((point) => ({
        date: point.date,
        value: Math.round(point.value * 10) / 10,
        label: formatShortDate(point.date),
      }));
      return {
        exercise: history[0].title,
        change: percentChange(points.at(-1)?.value ?? 0, points[0]?.value ?? 0),
        bestKg: Math.round(Math.max(...history.map((item) => item.value)) * 10) / 10,
        points,
      };
    });
  const trend = strengthTrends[0] ?? {
    exercise: "No weighted lift yet",
    change: 0,
    bestKg: 0,
    points: [],
  };

  const nowWeek = startOfWeek(now);
  const workloadWeeks = Array.from({ length: 8 }, (_, reverseIndex) => {
    const start = new Date(nowWeek.getTime() - (7 - reverseIndex) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const inWeek = sorted.filter((workout) => {
      const time = new Date(workout.start_time).getTime();
      return time >= start.getTime() && time < end.getTime();
    });
    return {
      label: formatShortDate(start.toISOString()),
      sets: countSets(inWeek),
      volumeKg: Math.round(totalVolume(inWeek)),
      sessions: inWeek.length,
    };
  });

  const records = [...histories.values()]
    .flatMap((history) => {
      const best = history
        .filter((point) => daysAgo(point.date, nowMs) >= 0 && daysAgo(point.date, nowMs) <= 30)
        .sort(
          (a, b) =>
            b.value - a.value ||
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        )[0];
      return best
        ? [
            {
              exercise: best.title,
              date: formatShortDate(best.date),
              valueKg: Math.round(best.value * 10) / 10,
              reps: best.reps,
              weightKg: best.weightKg,
            },
          ]
        : [];
    })
    .sort((a, b) => b.valueKg - a.valueKg)
    .slice(0, 5);

  const exerciseStats = [...exerciseTotals.entries()]
    .map(([id, totals]) => {
      const history = histories.get(id) ?? [];
      const recent = [...history].reverse().slice(-6);
      return {
        exercise: totals.title,
        muscle: titleCase(templateMap.get(id)?.primary_muscle_group ?? "other"),
        sessions: totals.sessions,
        workingSets: totals.sets,
        volumeKg: Math.round(totals.volumeKg),
        bestE1rmKg: history.length ? Math.round(Math.max(...history.map((point) => point.value)) * 10) / 10 : 0,
        change: recent.length >= 2 ? percentChange(recent.at(-1)?.value ?? 0, recent[0].value) : 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20);

  const exerciseOptions = exerciseStats.slice(0, 10).map((stat) => {
    const latestExercise = sorted.flatMap((workout) => workout.exercises).find((exercise) => exercise.title === stat.exercise);
    const latestSets = latestExercise?.sets.filter(isWorkingSet) ?? [];
    const representative = latestSets.find((set) => set.weight_kg && set.reps);
    return {
      name: stat.exercise,
      muscle: stat.muscle,
      sets: Math.min(Math.max(latestSets.length, 2), 4),
      reps: representative?.reps ?? null,
      weightKg: representative?.weight_kg ?? null,
      note: "Match the last clean effort; add a rep before load when possible.",
    };
  });

  const activeWeeks = workloadWeeks.filter((week) => week.sessions > 0).length;
  const consistencyPercent = Math.round((activeWeeks / workloadWeeks.length) * 100);
  const volumeChangePercent = percentChange(volume7d, previousVolume7d);
  const lastGap = sorted[0] ? Math.round(daysAgo(sorted[0].start_time, nowMs)) : 0;
  const plateau = Math.abs(trend.change) < 1.5;
  const biggestMuscle = [...muscles].sort((a, b) => b.sets - a.sets)[0];
  const lowestMuscle = [...muscles].filter((muscle) => muscle.sets > 0).sort((a, b) => a.sets - b.sets)[0];
  const weeklyReview = {
    label: `${formatShortDate(nowWeek.toISOString())}–${formatShortDate(new Date(nowWeek.getTime() + 6 * DAY).toISOString())}`,
    wins: [
      `${recent7.length} session${recent7.length === 1 ? "" : "s"} completed with ${workingSets7d} direct working sets.`,
      records.length ? `${records.length} estimated strength PR${records.length === 1 ? "" : "s"} appeared in the last 30 days.` : `${trend.exercise} is your clearest repeatable strength signal.`,
      volumeChangePercent > 0 ? `Load-volume is up ${volumeChangePercent}% versus the previous seven days.` : `${activeWeeks} of the last eight weeks include training.`,
    ],
    watch: [
      volumeChangePercent > 35 ? `Load-volume jumped ${volumeChangePercent}% week over week; monitor soreness and performance quality.` : `Weekly load-volume changed ${volumeChangePercent}% versus the prior week.`,
      biggestMuscle && lowestMuscle ? `${biggestMuscle.name} received ${biggestMuscle.sets} direct sets versus ${lowestMuscle.name} at ${lowestMuscle.sets}; confirm that this matches the goal.` : "Muscle balance needs another complete week of data.",
    ],
    nextSteps: [
      plateau ? `Keep ${trend.exercise} load stable and earn one additional clean rep before increasing weight.` : `Use the current ${trend.exercise} trend as the progression anchor next week.`,
      lastGap >= 7 ? `Resume with fewer hard sets after the ${lastGap}-day gap.` : "Keep the next session close to recent volume unless recovery says otherwise.",
    ],
  };

  return {
    analysis: createAnalysisMetadata(sorted, templates, now),
    connected: true,
    sourceLabel: "Live Hevy data",
    syncMessage: `Analyzed ${sorted.length} recent workouts`,
    athleteName,
    lastWorkout: sorted[0] ? `${sorted[0].title} · ${formatShortDate(sorted[0].start_time)}` : "No workouts found",
    stats: {
      sessions30d: recent30.length,
      workingSets7d,
      hours30d: Math.round((totalMinutes / 60) * 10) / 10,
      activeWeeks,
      totalVolume30dKg: Math.round(totalVolume(recent30)),
      avgSessionMinutes: recent30.length ? Math.round(totalMinutes / recent30.length) : 0,
      consistencyPercent,
      volumeChangePercent,
    },
    muscles,
    muscleWindows,
    trend: {
      exercise: trend.exercise,
      change: trend.change,
      points: trend.points,
    },
    strengthTrends,
    workloadWeeks,
    records,
    exerciseStats,
    recentWorkouts: sorted.slice(0, 8).map((workout) => ({
      title: workout.title,
      date: formatShortDate(workout.start_time),
      duration: `${Math.round(durationMinutes(workout))} min`,
      exercises: workout.exercises.length,
      workingSets: workout.exercises.flatMap((exercise) => exercise.sets).filter(isWorkingSet).length,
      volumeKg: Math.round(workoutVolume(workout)),
    })),
    calendarWorkouts: sorted.map((workout) => ({
      id: workout.id,
      title: workout.title,
      date: workout.start_time.slice(0, 10),
      time: formatTime(workout.start_time),
      durationMinutes: Math.round(durationMinutes(workout)),
      workingSets: workout.exercises.flatMap((exercise) => exercise.sets).filter(isWorkingSet).length,
      volumeKg: Math.round(workoutVolume(workout)),
      exercises: workout.exercises.map((exercise) => ({
        title: exercise.title,
        muscle: titleCase(templateMap.get(exercise.exercise_template_id)?.primary_muscle_group ?? "other"),
        sets: exercise.sets.map((set) => ({
          type: set.type ?? "normal",
          weightKg: set.weight_kg ?? null,
          reps: set.reps ?? null,
          rpe: set.rpe ?? null,
        })),
      })),
    })),
    exerciseOptions,
    weeklyReview,
    insights: {
      plateau: plateau
        ? `${trend.exercise} is effectively flat across ${trend.points.length} comparable sessions (${trend.change >= 0 ? "+" : ""}${trend.change}%). Check effort and technique before adding load.`
        : `${trend.exercise} is trending ${trend.change > 0 ? "up" : "down"} ${Math.abs(trend.change)}% across the visible sessions.`,
      return: lastGap >= 14 ? `Your last logged session was ${lastGap} days ago. Reduce working sets and leave several reps in reserve for the first week back.` : `Your latest logged session was ${lastGap} day${lastGap === 1 ? "" : "s"} ago, so the data does not indicate a long layoff.`,
      progress: `${trend.exercise} is the clearest current signal at ${trend.change >= 0 ? "+" : ""}${trend.change}%. Progress repeatable working sets, not one unusually hard top set.`,
    },
  };
}

function demoData(message = "Add HEVY_API_KEY to switch from sample data"): DashboardData {
  const points = [91.7, 92.5, 94.2, 94.5, 95.3, 96.1].map((value, index) => ({
    date: `2026-08-${index + 1}`,
    value,
    label: ["Jul 29", "Aug 5", "Aug 14", "Aug 22", "Aug 31", "Sep 8"][index],
  }));
  const exerciseOptions: ExerciseOption[] = [
    ["Incline Bench Press", "Chest", 3, 8, 65],
    ["Chest Supported Row", "Upper Back", 3, 10, 55],
    ["Cable Lateral Raise", "Shoulders", 3, 12, 9],
    ["Lat Pulldown", "Lats", 3, 9, 59],
    ["Cable Triceps Extension", "Triceps", 2, 12, 27],
    ["Incline Dumbbell Curl", "Biceps", 2, 10, 12],
  ].map(([name, muscle, sets, reps, weightKg]) => ({
    name: String(name),
    muscle: String(muscle),
    sets: Number(sets),
    reps: Number(reps),
    weightKg: Number(weightKg),
    note: "Match the last clean effort; add a rep before load.",
  }));
  const sampleExercises = [
    {
      title: "Bench Press (Barbell)",
      muscle: "Chest",
      sets: [
        { type: "warmup", weightKg: 40, reps: 10, rpe: null },
        { type: "normal", weightKg: 80, reps: 6, rpe: 8 },
        { type: "normal", weightKg: 80, reps: 6, rpe: 8.5 },
        { type: "normal", weightKg: 77.5, reps: 7, rpe: 9 },
      ],
    },
    {
      title: "Chest Supported Row",
      muscle: "Upper Back",
      sets: [
        { type: "normal", weightKg: 55, reps: 10, rpe: 8 },
        { type: "normal", weightKg: 55, reps: 10, rpe: 8 },
        { type: "normal", weightKg: 55, reps: 9, rpe: 9 },
      ],
    },
    {
      title: "Cable Lateral Raise",
      muscle: "Shoulders",
      sets: [
        { type: "normal", weightKg: 9, reps: 13, rpe: 8 },
        { type: "normal", weightKg: 9, reps: 12, rpe: 9 },
      ],
    },
  ];
  const calendarWorkouts: CalendarWorkout[] = [
    {
      id: "sample-upper-a",
      title: "Upper A",
      date: "2026-09-08",
      time: "6:10 PM",
      durationMinutes: 54,
      workingSets: 8,
      volumeKg: 7420,
      exercises: sampleExercises,
    },
    {
      id: "sample-lower-b",
      title: "Lower B",
      date: "2026-09-06",
      time: "11:20 AM",
      durationMinutes: 62,
      workingSets: 7,
      volumeKg: 9860,
      exercises: [
        {
          title: "Squat (Barbell)",
          muscle: "Quadriceps",
          sets: [
            { type: "warmup", weightKg: 70, reps: 6, rpe: null },
            { type: "normal", weightKg: 118, reps: 5, rpe: 8 },
            { type: "normal", weightKg: 118, reps: 5, rpe: 8.5 },
            { type: "normal", weightKg: 115, reps: 6, rpe: 9 },
          ],
        },
        {
          title: "Romanian Deadlift",
          muscle: "Hamstrings",
          sets: [
            { type: "normal", weightKg: 100, reps: 8, rpe: 8 },
            { type: "normal", weightKg: 100, reps: 8, rpe: 8.5 },
            { type: "normal", weightKg: 100, reps: 7, rpe: 9 },
          ],
        },
      ],
    },
    {
      id: "sample-pull",
      title: "Pull",
      date: "2026-09-04",
      time: "5:45 PM",
      durationMinutes: 48,
      workingSets: 8,
      volumeKg: 6250,
      exercises: sampleExercises.slice(1),
    },
    {
      id: "sample-upper-b",
      title: "Upper B",
      date: "2026-09-01",
      time: "6:05 PM",
      durationMinutes: 58,
      workingSets: 8,
      volumeKg: 8110,
      exercises: sampleExercises,
    },
  ];
  const muscles: MuscleDistribution[] = [
    ["Chest", 10, 8, 8240],
    ["Upper Back", 9, 9, 7120],
    ["Quadriceps", 8, 6, 9630],
    ["Shoulders", 7, 8, 2980],
    ["Hamstrings", 5, 5, 4310],
    ["Biceps", 4, 4, 1240],
  ].map(([name, sets, previousSets, volumeKg]) => ({
    name: String(name),
    sets: Number(sets),
    previousSets: Number(previousSets),
    volumeKg: Number(volumeKg),
  }));
  const scaleMuscles = (setMultiplier: number, volumeMultiplier: number) =>
    muscles.map((muscle) => ({
      ...muscle,
      sets: Math.round(muscle.sets * setMultiplier),
      previousSets: Math.round(muscle.previousSets * setMultiplier),
      volumeKg: Math.round(muscle.volumeKg * volumeMultiplier),
    }));
  return {
    analysis: createAnalysisMetadata([], [], new Date()),
    connected: false,
    sourceLabel: "Sample workspace",
    syncMessage: message,
    athleteName: "Athlete",
    lastWorkout: "Upper A · Sep 8",
    stats: {
      sessions30d: 14,
      workingSets7d: 46,
      hours30d: 13.8,
      activeWeeks: 7,
      totalVolume30dKg: 88240,
      avgSessionMinutes: 59,
      consistencyPercent: 88,
      volumeChangePercent: 8.4,
    },
    muscles,
    muscleWindows: {
      '7': muscles,
      '14': scaleMuscles(1.9, 1.9),
      '30': scaleMuscles(4, 4),
    },
    trend: { exercise: "Bench Press (Barbell)", change: 4.8, points },
    strengthTrends: [
      { exercise: "Bench Press (Barbell)", change: 4.8, bestKg: 96.1, points },
      {
        exercise: "Squat (Barbell)",
        change: 3.2,
        bestKg: 138.4,
        points: points.map((point) => ({
          ...point,
          value: point.value * 1.42,
        })),
      },
      {
        exercise: "Lat Pulldown",
        change: 1.7,
        bestKg: 74.2,
        points: points.map((point) => ({
          ...point,
          value: point.value * 0.76,
        })),
      },
    ],
    workloadWeeks: ["Jul 20", "Jul 27", "Aug 3", "Aug 10", "Aug 17", "Aug 24", "Aug 31", "Sep 7"].map((label, index) => ({
      label,
      sets: [38, 44, 41, 48, 45, 42, 50, 46][index],
      volumeKg: [18000, 21000, 19800, 23600, 22100, 20700, 24100, 22900][index],
      sessions: [3, 4, 3, 4, 4, 3, 4, 4][index],
    })),
    records: [
      {
        exercise: "Bench Press (Barbell)",
        date: "Sep 8",
        valueKg: 96.1,
        reps: 6,
        weightKg: 80,
      },
      {
        exercise: "Squat (Barbell)",
        date: "Sep 6",
        valueKg: 138.4,
        reps: 5,
        weightKg: 118,
      },
    ],
    exerciseStats: [
      {
        exercise: "Bench Press (Barbell)",
        muscle: "Chest",
        sessions: 14,
        workingSets: 48,
        volumeKg: 28200,
        bestE1rmKg: 96.1,
        change: 4.8,
      },
      {
        exercise: "Squat (Barbell)",
        muscle: "Quadriceps",
        sessions: 11,
        workingSets: 42,
        volumeKg: 39800,
        bestE1rmKg: 138.4,
        change: 3.2,
      },
      {
        exercise: "Lat Pulldown",
        muscle: "Lats",
        sessions: 10,
        workingSets: 36,
        volumeKg: 18400,
        bestE1rmKg: 74.2,
        change: 1.7,
      },
      {
        exercise: "Romanian Deadlift",
        muscle: "Hamstrings",
        sessions: 9,
        workingSets: 31,
        volumeKg: 27600,
        bestE1rmKg: 121.5,
        change: -0.8,
      },
    ],
    recentWorkouts: [
      {
        title: "Upper A",
        date: "Sep 8",
        duration: "54 min",
        exercises: 6,
        workingSets: 18,
        volumeKg: 7420,
      },
      {
        title: "Lower B",
        date: "Sep 6",
        duration: "62 min",
        exercises: 7,
        workingSets: 20,
        volumeKg: 9860,
      },
      {
        title: "Pull",
        date: "Sep 4",
        duration: "48 min",
        exercises: 6,
        workingSets: 17,
        volumeKg: 6250,
      },
      {
        title: "Upper B",
        date: "Sep 1",
        duration: "58 min",
        exercises: 7,
        workingSets: 21,
        volumeKg: 8110,
      },
    ],
    calendarWorkouts,
    exerciseOptions,
    weeklyReview: {
      label: "Sep 7–Sep 13",
      wins: ["Four sessions completed with 46 direct working sets.", "Two estimated strength PRs appeared in the last 30 days.", "Load-volume is up 8.4% week over week."],
      watch: ["Shoulder volume fell slightly versus last week.", "Lower-body sessions are running longer than average."],
      nextSteps: ["Keep bench load stable and earn one clean rep.", "Place the lower-body compound first next session."],
    },
    insights: {
      plateau: "Bench press is up 4.8% across six comparable sessions; hold load and look for one more clean rep.",
      return: "After a three-week break, reduce set count, keep several reps in reserve, and rebuild gradually.",
      progress: "Bench press is the clearest upward signal. Lateral raise is the next simple rep-progression opportunity.",
    },
  };
}

function unavailableData(message: string): DashboardData {
  const emptyWeeks = Array.from({ length: 8 }, (_, index) => ({
    label: `Week ${index + 1}`,
    sets: 0,
    volumeKg: 0,
    sessions: 0,
  }));
  return {
    analysis: createAnalysisMetadata([], [], new Date()),
    connected: false,
    sourceLabel: "Hevy unavailable",
    syncMessage: message,
    athleteName: "Athlete",
    lastWorkout: "Unavailable — sync Hevy to load verified history",
    stats: {
      sessions30d: 0,
      workingSets7d: 0,
      hours30d: 0,
      activeWeeks: 0,
      totalVolume30dKg: 0,
      avgSessionMinutes: 0,
      consistencyPercent: 0,
      volumeChangePercent: 0,
    },
    muscles: [],
    muscleWindows: { '7': [], '14': [], '30': [] },
    trend: { exercise: "No verified lift data", change: 0, points: [] },
    strengthTrends: [],
    workloadWeeks: emptyWeeks,
    records: [],
    exerciseStats: [],
    recentWorkouts: [],
    calendarWorkouts: [],
    exerciseOptions: [],
    weeklyReview: {
      label: "No verified data",
      wins: [],
      watch: ["Hevy history is unavailable, so no workout-specific coaching is safe yet."],
      nextSteps: ["Retry the Hevy sync before asking for progress feedback."],
    },
    insights: {
      plateau: "No verified Hevy data is available to assess a plateau.",
      return: "No verified Hevy data is available to assess a return plan.",
      progress: "No verified Hevy data is available to assess progress.",
    },
  };
}

export async function getDashboardData(userId = 'local-owner'): Promise<DashboardData> {
  const apiKey = process.env.HEVY_API_KEY;
  try {
    const { getHevySyncState, listStoredHevyWorkouts, listStoredTemplates } = await import('./hevy-repo');
    const [workouts, templateRows, syncState] = await Promise.all([
      listStoredHevyWorkouts(userId, { limit: 5_000 }),
      listStoredTemplates(userId),
      getHevySyncState(userId),
    ]);
    if (workouts.length) {
      const dashboard = analyzeWorkoutHistory(
        workouts,
        templateRows.map(deserializeHevyTemplate),
        'Athlete',
      );
      const progress = syncState?.lastError
        ? ' · latest sync needs attention'
        : syncState?.fullSyncCompletedAt
          ? ''
          : syncState?.fullSyncPageCount
            ? ` · importing page ${syncState.fullSyncNextPage} of ${syncState.fullSyncPageCount}`
            : ' · importing full history';
      return {
        ...dashboard,
        sourceLabel: 'Synchronized Hevy history',
        syncMessage: `Analyzed ${workouts.length} workouts${progress}`,
      };
    }

    if (!apiKey) return demoData();
    return unavailableData(
      syncState?.lastError
        ? `Hevy sync needs attention: ${syncState.lastError}`
        : 'Hevy is connected. Select sync to import your training history.',
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown storage error";
    return unavailableData(`Hevy connection needs attention: ${reason}`);
  }
}
