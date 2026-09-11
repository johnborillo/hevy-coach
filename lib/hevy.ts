export type TrendPoint = { date: string; value: number; label: string };

export type ExerciseOption = {
  name: string;
  muscle: string;
  sets: number;
  reps: number | null;
  weightKg: number | null;
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
    totalVolume30dKg: number;
    avgSessionMinutes: number;
    consistencyPercent: number;
    volumeChangePercent: number;
  };
  muscles: Array<{ name: string; sets: number; previousSets: number; volumeKg: number }>;
  trend: { exercise: string; change: number; points: TrendPoint[] };
  strengthTrends: Array<{ exercise: string; change: number; bestKg: number; points: TrendPoint[] }>;
  workloadWeeks: Array<{ label: string; sets: number; volumeKg: number; sessions: number }>;
  records: Array<{ exercise: string; date: string; valueKg: number; reps: number; weightKg: number }>;
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
  exerciseOptions: ExerciseOption[];
  weeklyReview: { label: string; wins: string[]; watch: string[]; nextSteps: string[] };
  insights: { plateau: string; return: string; progress: string };
};

type HevySet = { type?: string; weight_kg?: number | null; reps?: number | null; rpe?: number | null };
type HevyExercise = { title: string; exercise_template_id: string; sets: HevySet[] };
type HevyWorkout = { id: string; title: string; start_time: string; end_time: string; exercises: HevyExercise[] };
type ExerciseTemplate = { id: string; title: string; primary_muscle_group?: string };

const API_ROOT = 'https://api.hevyapp.com/v1';
const DAY = 86_400_000;

function isWorkingSet(set: HevySet) {
  return set.type !== 'warmup';
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function daysAgo(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / DAY;
}

function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(iso));
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

async function hevyGet<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: { 'api-key': apiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hevy returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchWorkouts(apiKey: string) {
  const first = await hevyGet<{ page_count: number; workouts: HevyWorkout[] }>('/workouts?page=1&pageSize=10', apiKey);
  const workouts = [...first.workouts];
  for (let page = 2; page <= Math.min(first.page_count, 12); page += 1) {
    const result = await hevyGet<{ workouts: HevyWorkout[] }>(`/workouts?page=${page}&pageSize=10`, apiKey);
    workouts.push(...result.workouts);
  }
  return workouts;
}

async function fetchTemplates(apiKey: string) {
  const first = await hevyGet<{ page_count: number; exercise_templates: ExerciseTemplate[] }>('/exercise_templates?page=1&pageSize=100', apiKey);
  const templates = [...first.exercise_templates];
  for (let page = 2; page <= Math.min(first.page_count, 8); page += 1) {
    const result = await hevyGet<{ exercise_templates: ExerciseTemplate[] }>(`/exercise_templates?page=${page}&pageSize=100`, apiKey);
    templates.push(...result.exercise_templates);
  }
  return templates;
}

function analyze(workouts: HevyWorkout[], templates: ExerciseTemplate[], athleteName: string): DashboardData {
  const sorted = [...workouts].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const recent30 = sorted.filter((workout) => daysAgo(workout.start_time) <= 30);
  const recent7 = sorted.filter((workout) => daysAgo(workout.start_time) <= 7);
  const previous7 = sorted.filter((workout) => daysAgo(workout.start_time) > 7 && daysAgo(workout.start_time) <= 14);
  const countSets = (items: HevyWorkout[]) => items.flatMap((workout) => workout.exercises).flatMap((exercise) => exercise.sets).filter(isWorkingSet).length;
  const totalVolume = (items: HevyWorkout[]) => items.reduce((sum, workout) => sum + workoutVolume(workout), 0);
  const workingSets7d = countSets(recent7);
  const volume7d = totalVolume(recent7);
  const previousVolume7d = totalVolume(previous7);
  const totalMinutes = recent30.reduce((sum, workout) => sum + durationMinutes(workout), 0);

  const muscleCurrent = new Map<string, { sets: number; volumeKg: number }>();
  const musclePrevious = new Map<string, number>();
  for (const [items, current] of [[recent7, true], [previous7, false]] as const) {
    for (const workout of items) {
      for (const exercise of workout.exercises) {
        const muscle = templateMap.get(exercise.exercise_template_id)?.primary_muscle_group ?? 'other';
        const sets = exercise.sets.filter(isWorkingSet);
        if (current) {
          const value = muscleCurrent.get(muscle) ?? { sets: 0, volumeKg: 0 };
          value.sets += sets.length;
          value.volumeKg += sets.reduce((sum, set) => sum + setVolume(set), 0);
          muscleCurrent.set(muscle, value);
        } else {
          musclePrevious.set(muscle, (musclePrevious.get(muscle) ?? 0) + sets.length);
        }
      }
    }
  }

  const histories = new Map<string, Array<{ date: string; value: number; title: string; reps: number; weightKg: number }>>();
  const exerciseTotals = new Map<string, { title: string; sessions: number; sets: number; volumeKg: number }>();
  for (const workout of sorted) {
    for (const exercise of workout.exercises) {
      const working = exercise.sets.filter(isWorkingSet);
      const total = exerciseTotals.get(exercise.exercise_template_id) ?? { title: exercise.title, sessions: 0, sets: 0, volumeKg: 0 };
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
      history.push({ date: workout.start_time, value: best.value as number, title: exercise.title, reps: best.set.reps as number, weightKg: best.set.weight_kg as number });
      histories.set(exercise.exercise_template_id, history);
    }
  }

  const strengthTrends = [...histories.values()]
    .filter((history) => history.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6)
    .map((history) => {
      const chronological = [...history].reverse().slice(-8);
      const points = chronological.map((point) => ({ date: point.date, value: Math.round(point.value * 10) / 10, label: formatShortDate(point.date) }));
      return { exercise: history[0].title, change: percentChange(points.at(-1)?.value ?? 0, points[0]?.value ?? 0), bestKg: Math.round(Math.max(...history.map((item) => item.value)) * 10) / 10, points };
    });
  const trend = strengthTrends[0] ?? { exercise: 'No weighted lift yet', change: 0, bestKg: 0, points: [] };

  const nowWeek = startOfWeek(new Date());
  const workloadWeeks = Array.from({ length: 8 }, (_, reverseIndex) => {
    const start = new Date(nowWeek.getTime() - (7 - reverseIndex) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const inWeek = sorted.filter((workout) => {
      const time = new Date(workout.start_time).getTime();
      return time >= start.getTime() && time < end.getTime();
    });
    return { label: formatShortDate(start.toISOString()), sets: countSets(inWeek), volumeKg: Math.round(totalVolume(inWeek)), sessions: inWeek.length };
  });

  const records = [...histories.values()]
    .flatMap((history) => {
      const best = [...history].sort((a, b) => b.value - a.value)[0];
      return daysAgo(best.date) <= 30 ? [{ exercise: best.title, date: formatShortDate(best.date), valueKg: Math.round(best.value * 10) / 10, reps: best.reps, weightKg: best.weightKg }] : [];
    })
    .sort((a, b) => b.valueKg - a.valueKg)
    .slice(0, 5);

  const exerciseStats = [...exerciseTotals.entries()]
    .map(([id, totals]) => {
      const history = histories.get(id) ?? [];
      const recent = [...history].reverse().slice(-6);
      return {
        exercise: totals.title,
        muscle: titleCase(templateMap.get(id)?.primary_muscle_group ?? 'other'),
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
    return { name: stat.exercise, muscle: stat.muscle, sets: Math.min(Math.max(latestSets.length, 2), 4), reps: representative?.reps ?? null, weightKg: representative?.weight_kg ?? null, note: 'Match the last clean effort; add a rep before load when possible.' };
  });

  const activeWeeks = workloadWeeks.filter((week) => week.sessions > 0).length;
  const consistencyPercent = Math.round((activeWeeks / workloadWeeks.length) * 100);
  const volumeChangePercent = percentChange(volume7d, previousVolume7d);
  const lastGap = sorted[0] ? Math.round(daysAgo(sorted[0].start_time)) : 0;
  const plateau = Math.abs(trend.change) < 1.5;
  const biggestMuscle = [...muscleCurrent.entries()].sort((a, b) => b[1].sets - a[1].sets)[0];
  const lowestMuscle = [...muscleCurrent.entries()].filter(([, value]) => value.sets > 0).sort((a, b) => a[1].sets - b[1].sets)[0];
  const weeklyReview = {
    label: `${formatShortDate(nowWeek.toISOString())}–${formatShortDate(new Date(nowWeek.getTime() + 6 * DAY).toISOString())}`,
    wins: [
      `${recent7.length} session${recent7.length === 1 ? '' : 's'} completed with ${workingSets7d} direct working sets.`,
      records.length ? `${records.length} estimated strength PR${records.length === 1 ? '' : 's'} appeared in the last 30 days.` : `${trend.exercise} is your clearest repeatable strength signal.`,
      volumeChangePercent > 0 ? `Load-volume is up ${volumeChangePercent}% versus the previous seven days.` : `${activeWeeks} of the last eight weeks include training.`,
    ],
    watch: [
      volumeChangePercent > 35 ? `Load-volume jumped ${volumeChangePercent}% week over week; monitor soreness and performance quality.` : `Weekly load-volume changed ${volumeChangePercent}% versus the prior week.`,
      biggestMuscle && lowestMuscle ? `${titleCase(biggestMuscle[0])} received ${biggestMuscle[1].sets} direct sets versus ${titleCase(lowestMuscle[0])} at ${lowestMuscle[1].sets}; confirm that this matches the goal.` : 'Muscle balance needs another complete week of data.',
    ],
    nextSteps: [
      plateau ? `Keep ${trend.exercise} load stable and earn one additional clean rep before increasing weight.` : `Use the current ${trend.exercise} trend as the progression anchor next week.`,
      lastGap >= 7 ? `Resume with fewer hard sets after the ${lastGap}-day gap.` : 'Keep the next session close to recent volume unless recovery says otherwise.',
    ],
  };

  return {
    connected: true,
    sourceLabel: 'Live Hevy data',
    syncMessage: `Analyzed ${sorted.length} recent workouts`,
    athleteName,
    lastWorkout: sorted[0] ? `${sorted[0].title} · ${formatShortDate(sorted[0].start_time)}` : 'No workouts found',
    stats: { sessions30d: recent30.length, workingSets7d, hours30d: Math.round((totalMinutes / 60) * 10) / 10, activeWeeks, totalVolume30dKg: Math.round(totalVolume(recent30)), avgSessionMinutes: recent30.length ? Math.round(totalMinutes / recent30.length) : 0, consistencyPercent, volumeChangePercent },
    muscles: [...muscleCurrent.entries()].map(([name, value]) => ({ name: titleCase(name), sets: value.sets, previousSets: musclePrevious.get(name) ?? 0, volumeKg: Math.round(value.volumeKg) })).sort((a, b) => b.sets - a.sets).slice(0, 10),
    trend: { exercise: trend.exercise, change: trend.change, points: trend.points },
    strengthTrends,
    workloadWeeks,
    records,
    exerciseStats,
    recentWorkouts: sorted.slice(0, 8).map((workout) => ({ title: workout.title, date: formatShortDate(workout.start_time), duration: `${Math.round(durationMinutes(workout))} min`, exercises: workout.exercises.length, workingSets: workout.exercises.flatMap((exercise) => exercise.sets).filter(isWorkingSet).length, volumeKg: Math.round(workoutVolume(workout)) })),
    exerciseOptions,
    weeklyReview,
    insights: {
      plateau: plateau ? `${trend.exercise} is effectively flat across ${trend.points.length} comparable sessions (${trend.change >= 0 ? '+' : ''}${trend.change}%). Check effort and technique before adding load.` : `${trend.exercise} is trending ${trend.change > 0 ? 'up' : 'down'} ${Math.abs(trend.change)}% across the visible sessions.`,
      return: lastGap >= 14 ? `Your last logged session was ${lastGap} days ago. Reduce working sets and leave several reps in reserve for the first week back.` : `Your latest logged session was ${lastGap} day${lastGap === 1 ? '' : 's'} ago, so the data does not indicate a long layoff.`,
      progress: `${trend.exercise} is the clearest current signal at ${trend.change >= 0 ? '+' : ''}${trend.change}%. Progress repeatable working sets, not one unusually hard top set.`,
    },
  };
}

function demoData(message = 'Add HEVY_API_KEY to switch from sample data'): DashboardData {
  const points = [91.7, 92.5, 94.2, 94.5, 95.3, 96.1].map((value, index) => ({ date: `2026-08-${index + 1}`, value, label: ['Jul 29', 'Aug 5', 'Aug 14', 'Aug 22', 'Aug 31', 'Sep 8'][index] }));
  const exerciseOptions: ExerciseOption[] = [
    ['Incline Bench Press', 'Chest', 3, 8, 65], ['Chest Supported Row', 'Upper Back', 3, 10, 55], ['Cable Lateral Raise', 'Shoulders', 3, 12, 9], ['Lat Pulldown', 'Lats', 3, 9, 59], ['Cable Triceps Extension', 'Triceps', 2, 12, 27], ['Incline Dumbbell Curl', 'Biceps', 2, 10, 12],
  ].map(([name, muscle, sets, reps, weightKg]) => ({ name: String(name), muscle: String(muscle), sets: Number(sets), reps: Number(reps), weightKg: Number(weightKg), note: 'Match the last clean effort; add a rep before load.' }));
  return {
    connected: false, sourceLabel: 'Sample workspace', syncMessage: message, athleteName: 'Athlete', lastWorkout: 'Upper A · Sep 8',
    stats: { sessions30d: 14, workingSets7d: 46, hours30d: 13.8, activeWeeks: 7, totalVolume30dKg: 88240, avgSessionMinutes: 59, consistencyPercent: 88, volumeChangePercent: 8.4 },
    muscles: [['Chest', 10, 8, 8240], ['Upper Back', 9, 9, 7120], ['Quadriceps', 8, 6, 9630], ['Shoulders', 7, 8, 2980], ['Hamstrings', 5, 5, 4310], ['Biceps', 4, 4, 1240]].map(([name, sets, previousSets, volumeKg]) => ({ name: String(name), sets: Number(sets), previousSets: Number(previousSets), volumeKg: Number(volumeKg) })),
    trend: { exercise: 'Bench Press (Barbell)', change: 4.8, points },
    strengthTrends: [
      { exercise: 'Bench Press (Barbell)', change: 4.8, bestKg: 96.1, points },
      { exercise: 'Squat (Barbell)', change: 3.2, bestKg: 138.4, points: points.map((point) => ({ ...point, value: point.value * 1.42 })) },
      { exercise: 'Lat Pulldown', change: 1.7, bestKg: 74.2, points: points.map((point) => ({ ...point, value: point.value * 0.76 })) },
    ],
    workloadWeeks: ['Jul 20', 'Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7'].map((label, index) => ({ label, sets: [38, 44, 41, 48, 45, 42, 50, 46][index], volumeKg: [18000, 21000, 19800, 23600, 22100, 20700, 24100, 22900][index], sessions: [3, 4, 3, 4, 4, 3, 4, 4][index] })),
    records: [{ exercise: 'Bench Press (Barbell)', date: 'Sep 8', valueKg: 96.1, reps: 6, weightKg: 80 }, { exercise: 'Squat (Barbell)', date: 'Sep 6', valueKg: 138.4, reps: 5, weightKg: 118 }],
    exerciseStats: [{ exercise: 'Bench Press (Barbell)', muscle: 'Chest', sessions: 14, workingSets: 48, volumeKg: 28200, bestE1rmKg: 96.1, change: 4.8 }, { exercise: 'Squat (Barbell)', muscle: 'Quadriceps', sessions: 11, workingSets: 42, volumeKg: 39800, bestE1rmKg: 138.4, change: 3.2 }, { exercise: 'Lat Pulldown', muscle: 'Lats', sessions: 10, workingSets: 36, volumeKg: 18400, bestE1rmKg: 74.2, change: 1.7 }, { exercise: 'Romanian Deadlift', muscle: 'Hamstrings', sessions: 9, workingSets: 31, volumeKg: 27600, bestE1rmKg: 121.5, change: -0.8 }],
    recentWorkouts: [{ title: 'Upper A', date: 'Sep 8', duration: '54 min', exercises: 6, workingSets: 18, volumeKg: 7420 }, { title: 'Lower B', date: 'Sep 6', duration: '62 min', exercises: 7, workingSets: 20, volumeKg: 9860 }, { title: 'Pull', date: 'Sep 4', duration: '48 min', exercises: 6, workingSets: 17, volumeKg: 6250 }, { title: 'Upper B', date: 'Sep 1', duration: '58 min', exercises: 7, workingSets: 21, volumeKg: 8110 }],
    exerciseOptions,
    weeklyReview: { label: 'Sep 7–Sep 13', wins: ['Four sessions completed with 46 direct working sets.', 'Two estimated strength PRs appeared in the last 30 days.', 'Load-volume is up 8.4% week over week.'], watch: ['Shoulder volume fell slightly versus last week.', 'Lower-body sessions are running longer than average.'], nextSteps: ['Keep bench load stable and earn one clean rep.', 'Place the lower-body compound first next session.'] },
    insights: { plateau: 'Bench press is up 4.8% across six comparable sessions; hold load and look for one more clean rep.', return: 'After a three-week break, reduce set count, keep several reps in reserve, and rebuild gradually.', progress: 'Bench press is the clearest upward signal. Lateral raise is the next simple rep-progression opportunity.' },
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const apiKey = process.env.HEVY_API_KEY;
  if (!apiKey) return demoData();
  try {
    const [workouts, templates, user] = await Promise.all([
      fetchWorkouts(apiKey),
      fetchTemplates(apiKey),
      hevyGet<{ data?: { name?: string }; name?: string }>('/user/info', apiKey),
    ]);
    return analyze(workouts, templates, user.data?.name ?? user.name ?? 'Athlete');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown sync error';
    return demoData(`Hevy connection needs attention: ${reason}`);
  }
}
