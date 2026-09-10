export type TrendPoint = {
  date: string;
  value: number;
  label: string;
};

export type ExerciseOption = {
  name: string;
  muscle: string;
  prescription: string;
  note: string;
};

export type DashboardData = {
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
  };
  muscles: Array<{ name: string; sets: number }>;
  trend: {
    exercise: string;
    change: number;
    points: TrendPoint[];
  };
  recentWorkouts: Array<{
    title: string;
    date: string;
    duration: string;
    exercises: number;
    workingSets: number;
  }>;
  exerciseOptions: ExerciseOption[];
  insights: {
    plateau: string;
    return: string;
    progress: string;
  };
};

type HevySet = {
  type?: string;
  weight_kg?: number | null;
  reps?: number | null;
  rpe?: number | null;
};

type HevyExercise = {
  title: string;
  exercise_template_id: string;
  sets: HevySet[];
};

type HevyWorkout = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  exercises: HevyExercise[];
};

type ExerciseTemplate = {
  id: string;
  title: string;
  primary_muscle_group?: string;
};

const API_ROOT = 'https://api.hevyapp.com/v1';

function isWorkingSet(set: HevySet) {
  return set.type !== 'warmup';
}

function titleCase(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function daysAgo(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

function formatDuration(start: string, end: string) {
  const minutes = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
  return `${minutes} min`;
}

function estimatedOneRepMax(set: HevySet) {
  if (!set.weight_kg || !set.reps || set.reps > 15) return null;
  return set.weight_kg * (1 + set.reps / 30);
}

async function hevyGet<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: { 'api-key': apiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Hevy returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchWorkouts(apiKey: string) {
  const first = await hevyGet<{
    page_count: number;
    workouts: HevyWorkout[];
  }>('/workouts?page=1&pageSize=10', apiKey);
  const workouts = [...first.workouts];
  const pageLimit = Math.min(first.page_count, 12);

  for (let page = 2; page <= pageLimit; page += 1) {
    const result = await hevyGet<{ workouts: HevyWorkout[] }>(
      `/workouts?page=${page}&pageSize=10`,
      apiKey,
    );
    workouts.push(...result.workouts);
  }

  return workouts;
}

async function fetchTemplates(apiKey: string) {
  const first = await hevyGet<{
    page_count: number;
    exercise_templates: ExerciseTemplate[];
  }>('/exercise_templates?page=1&pageSize=100', apiKey);
  const templates = [...first.exercise_templates];
  const pageLimit = Math.min(first.page_count, 8);

  for (let page = 2; page <= pageLimit; page += 1) {
    const result = await hevyGet<{ exercise_templates: ExerciseTemplate[] }>(
      `/exercise_templates?page=${page}&pageSize=100`,
      apiKey,
    );
    templates.push(...result.exercise_templates);
  }

  return templates;
}

function analyze(
  workouts: HevyWorkout[],
  templates: ExerciseTemplate[],
  athleteName: string,
): DashboardData {
  const sorted = [...workouts].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  );
  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const recent30 = sorted.filter((workout) => daysAgo(workout.start_time) <= 30);
  const recent7 = sorted.filter((workout) => daysAgo(workout.start_time) <= 7);
  const workingSets7d = recent7
    .flatMap((workout) => workout.exercises)
    .flatMap((exercise) => exercise.sets)
    .filter(isWorkingSet).length;
  const totalMinutes = recent30.reduce(
    (sum, workout) =>
      sum +
      Math.max(
        0,
        (new Date(workout.end_time).getTime() -
          new Date(workout.start_time).getTime()) /
          60_000,
      ),
    0,
  );

  const muscleCounts = new Map<string, number>();
  for (const workout of recent7) {
    for (const exercise of workout.exercises) {
      const muscle =
        templateMap.get(exercise.exercise_template_id)?.primary_muscle_group ??
        'other';
      const setCount = exercise.sets.filter(isWorkingSet).length;
      muscleCounts.set(muscle, (muscleCounts.get(muscle) ?? 0) + setCount);
    }
  }

  const exerciseSessions = new Map<
    string,
    Array<{ date: string; value: number; title: string }>
  >();
  for (const workout of sorted) {
    for (const exercise of workout.exercises) {
      const estimates = exercise.sets
        .map(estimatedOneRepMax)
        .filter((value): value is number => value !== null);
      if (estimates.length === 0) continue;
      const best = Math.max(...estimates);
      const history = exerciseSessions.get(exercise.exercise_template_id) ?? [];
      history.push({ date: workout.start_time, value: best, title: exercise.title });
      exerciseSessions.set(exercise.exercise_template_id, history);
    }
  }

  const primaryTrend = [...exerciseSessions.values()]
    .filter((history) => history.length >= 3)
    .sort((a, b) => b.length - a.length)[0];
  const chronological = primaryTrend ? [...primaryTrend].reverse().slice(-7) : [];
  const trendPoints = chronological.map((point) => ({
    date: point.date,
    value: Math.round(point.value * 10) / 10,
    label: formatShortDate(point.date),
  }));
  const firstValue = trendPoints.at(0)?.value ?? 0;
  const lastValue = trendPoints.at(-1)?.value ?? 0;
  const trendChange = firstValue
    ? Math.round(((lastValue - firstValue) / firstValue) * 1000) / 10
    : 0;

  const exerciseFrequency = new Map<string, number>();
  for (const workout of sorted.filter((item) => daysAgo(item.start_time) <= 60)) {
    for (const exercise of workout.exercises) {
      exerciseFrequency.set(
        exercise.exercise_template_id,
        (exerciseFrequency.get(exercise.exercise_template_id) ?? 0) + 1,
      );
    }
  }

  const exerciseOptions = [...exerciseFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => {
      const latestExercise = sorted
        .flatMap((workout) => workout.exercises)
        .find((exercise) => exercise.exercise_template_id === id);
      const working = latestExercise?.sets.filter(isWorkingSet) ?? [];
      const representative = working.find((set) => set.weight_kg && set.reps);
      const prescription = representative
        ? `${Math.min(Math.max(working.length, 2), 4)} × ${representative.reps} @ ${representative.weight_kg} kg`
        : `${Math.min(Math.max(working.length, 2), 4)} working sets`;
      return {
        name: latestExercise?.title ?? templateMap.get(id)?.title ?? 'Exercise',
        muscle: titleCase(templateMap.get(id)?.primary_muscle_group ?? 'other'),
        prescription,
        note: 'Match last effort; add a rep only if form stays clean.',
      };
    });

  const lastGap = sorted[0] ? Math.round(daysAgo(sorted[0].start_time)) : 0;
  const trendExercise = primaryTrend?.[0]?.title ?? 'Your most frequent lift';
  const plateauMessage =
    Math.abs(trendChange) < 1.5
      ? `${trendExercise} is effectively flat across ${trendPoints.length} comparable sessions (${trendChange >= 0 ? '+' : ''}${trendChange}%). Check whether RPE is rising before adding load; stable performance at lower effort is still progress.`
      : `${trendExercise} is trending ${trendChange > 0 ? 'up' : 'down'} ${Math.abs(trendChange)}% across the visible comparable sessions. Review load, reps and effort together before calling it a plateau.`;

  return {
    connected: true,
    sourceLabel: 'Live Hevy data',
    syncMessage: `Analyzed ${sorted.length} recent workouts`,
    athleteName,
    lastWorkout: sorted[0]
      ? `${sorted[0].title} · ${formatShortDate(sorted[0].start_time)}`
      : 'No workouts found',
    stats: {
      sessions30d: recent30.length,
      workingSets7d,
      hours30d: Math.round((totalMinutes / 60) * 10) / 10,
      activeWeeks: new Set(
        recent30.map((workout) => {
          const date = new Date(workout.start_time);
          const first = new Date(date.getFullYear(), 0, 1);
          return Math.ceil(
            ((date.getTime() - first.getTime()) / 86_400_000 +
              first.getDay() +
              1) /
              7,
          );
        }),
      ).size,
    },
    muscles: [...muscleCounts.entries()]
      .map(([name, sets]) => ({ name: titleCase(name), sets }))
      .sort((a, b) => b.sets - a.sets)
      .slice(0, 6),
    trend: {
      exercise: trendExercise,
      change: trendChange,
      points: trendPoints,
    },
    recentWorkouts: sorted.slice(0, 4).map((workout) => ({
      title: workout.title,
      date: formatShortDate(workout.start_time),
      duration: formatDuration(workout.start_time, workout.end_time),
      exercises: workout.exercises.length,
      workingSets: workout.exercises
        .flatMap((exercise) => exercise.sets)
        .filter(isWorkingSet).length,
    })),
    exerciseOptions,
    insights: {
      plateau: plateauMessage,
      return:
        lastGap >= 14
          ? `Your last logged session was ${lastGap} days ago. Start with fewer working sets and leave several reps in reserve, then rebuild over the next few exposures if recovery is normal.`
          : `Your latest logged session was ${lastGap} day${lastGap === 1 ? '' : 's'} ago, so the data does not indicate a long layoff. If you were sick, injured or training elsewhere, record that before generating a return plan.`,
      progress: `${trendExercise} is the clearest current signal at ${trendChange >= 0 ? '+' : ''}${trendChange}%. Your next progression should come from the most repeatable working sets—not a single unusually hard top set.`,
    },
  };
}

function demoData(
  message = 'Add HEVY_API_KEY to switch from sample data',
): DashboardData {
  return {
    connected: false,
    sourceLabel: 'Sample workspace',
    syncMessage: message,
    athleteName: 'Athlete',
    lastWorkout: 'Upper A · Sep 8',
    stats: {
      sessions30d: 14,
      workingSets7d: 46,
      hours30d: 13.8,
      activeWeeks: 4,
    },
    muscles: [
      { name: 'Chest', sets: 10 },
      { name: 'Upper Back', sets: 9 },
      { name: 'Quadriceps', sets: 8 },
      { name: 'Shoulders', sets: 7 },
      { name: 'Hamstrings', sets: 5 },
      { name: 'Biceps', sets: 4 },
    ],
    trend: {
      exercise: 'Bench Press (Barbell)',
      change: 4.8,
      points: [
        { date: '2026-07-29', value: 91.7, label: 'Jul 29' },
        { date: '2026-08-05', value: 92.5, label: 'Aug 5' },
        { date: '2026-08-14', value: 94.2, label: 'Aug 14' },
        { date: '2026-08-22', value: 94.5, label: 'Aug 22' },
        { date: '2026-08-31', value: 95.3, label: 'Aug 31' },
        { date: '2026-09-08', value: 96.1, label: 'Sep 8' },
      ],
    },
    recentWorkouts: [
      {
        title: 'Upper A',
        date: 'Sep 8',
        duration: '54 min',
        exercises: 6,
        workingSets: 18,
      },
      {
        title: 'Lower B',
        date: 'Sep 6',
        duration: '62 min',
        exercises: 7,
        workingSets: 20,
      },
      {
        title: 'Pull',
        date: 'Sep 4',
        duration: '48 min',
        exercises: 6,
        workingSets: 17,
      },
      {
        title: 'Upper B',
        date: 'Sep 1',
        duration: '58 min',
        exercises: 7,
        workingSets: 21,
      },
    ],
    exerciseOptions: [
      {
        name: 'Incline Bench Press',
        muscle: 'Chest',
        prescription: '3 × 8 @ 65 kg',
        note: 'Hold two reps in reserve.',
      },
      {
        name: 'Chest Supported Row',
        muscle: 'Upper Back',
        prescription: '3 × 10 @ 55 kg',
        note: 'Pause briefly at peak contraction.',
      },
      {
        name: 'Cable Lateral Raise',
        muscle: 'Shoulders',
        prescription: '3 × 12 @ 9 kg',
        note: 'Add a rep before adding load.',
      },
      {
        name: 'Lat Pulldown',
        muscle: 'Lats',
        prescription: '3 × 9 @ 59 kg',
        note: 'Match last session with cleaner reps.',
      },
      {
        name: 'Cable Triceps Extension',
        muscle: 'Triceps',
        prescription: '2 × 12 @ 27 kg',
        note: 'Stop if elbow discomfort appears.',
      },
      {
        name: 'Incline Dumbbell Curl',
        muscle: 'Biceps',
        prescription: '2 × 10 @ 12 kg',
        note: 'Keep the eccentric controlled.',
      },
    ],
    insights: {
      plateau:
        'Bench press is not truly stalled yet: estimated strength is up 4.8% across six comparable sessions. The last two sessions are flatter, so hold load steady and look for one more clean rep before increasing weight.',
      return:
        'The sample history does not show a long layoff. After a three-week break, begin below your previous set count, keep several reps in reserve and rebuild only when soreness and performance normalize.',
      progress:
        'Bench press has the clearest upward signal. Cable lateral raise is the next simple progression opportunity because the current load has reached the top of its target rep range.',
    },
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const apiKey = process.env.HEVY_API_KEY;
  if (!apiKey) return demoData();

  try {
    const [workouts, templates, user] = await Promise.all([
      fetchWorkouts(apiKey),
      fetchTemplates(apiKey),
      hevyGet<{ data?: { name?: string } }>('/user/info', apiKey),
    ]);
    return analyze(workouts, templates, user.data?.name ?? 'Athlete');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown sync error';
    return demoData(`Hevy connection needs attention: ${reason}`);
  }
}
