import type { DashboardData } from '@/lib/hevy';
import type { AthleteProfile, TrainingProgram } from '@/lib/storage';

export type ProgramRequest = {
  goal: string;
  durationWeeks: number;
  daysPerWeek: number;
  minutesPerSession: number;
  preferences: string;
};

export function buildFallbackProgram(
  input: ProgramRequest,
  profile: AthleteProfile,
  dashboard: DashboardData,
): Omit<TrainingProgram, 'id' | 'createdAt'> {
  const lowerGoal = /\b(leg|legs|lower|quad|hamstring|glute|calf)\b/i.test(input.goal);
  const loggedOptions = [
    ...dashboard.exerciseOptions,
    ...dashboard.exerciseStats.map((exercise) => ({
      name: exercise.exercise,
      muscle: exercise.muscle,
      sets: Math.min(Math.max(Math.round(exercise.workingSets / Math.max(exercise.sessions, 1)), 2), 4),
      reps: null,
      weightKg: null,
      note: 'Match the last clean effort; add a rep before load when possible.',
    })),
  ];
  const uniqueOptions = loggedOptions.filter(
    (exercise, index, all) => all.findIndex((item) => item.name === exercise.name) === index,
  );
  const lowerOptions = uniqueOptions.filter((exercise) =>
    /quad|hamstring|glute|calf|leg|lower|squat|deadlift|lunge|hip/i.test(
      `${exercise.name} ${exercise.muscle}`,
    ),
  );
  const fallbackLower = [
    { name: 'Squat', muscle: 'Quadriceps', sets: 3, reps: 8, weightKg: null, note: 'Use a controlled effort and stop with clean reps in reserve.' },
    { name: 'Romanian Deadlift', muscle: 'Hamstrings', sets: 3, reps: 8, weightKg: null, note: 'Keep the eccentric controlled and brace consistently.' },
    { name: 'Leg Press', muscle: 'Quadriceps', sets: 3, reps: 10, weightKg: null, note: 'Use a stable range of motion that keeps the pelvis controlled.' },
    { name: 'Leg Curl', muscle: 'Hamstrings', sets: 3, reps: 12, weightKg: null, note: 'Pause briefly in the shortened position.' },
    { name: 'Calf Raise', muscle: 'Calves', sets: 3, reps: 12, weightKg: null, note: 'Use a full stretch and controlled pause.' },
  ];
  const allOptions = uniqueOptions.length
    ? uniqueOptions
    : [{ name: 'Primary compound', muscle: 'Full body', sets: 3, reps: 8, weightKg: null, note: 'Use a controlled effort.' }];
  const options = lowerGoal
    ? (lowerOptions.length ? lowerOptions : fallbackLower)
    : allOptions;
  const dayNames = lowerGoal
    ? ['Lower A', 'Lower B', 'Lower C', 'Lower D', 'Lower E']
    : input.daysPerWeek <= 3
      ? ['Full Body A', 'Full Body B', 'Full Body C']
      : ['Upper A', 'Lower A', 'Upper B', 'Lower B', 'Full Body'];
  const exercisesPerDay = input.minutesPerSession <= 40 ? 4 : input.minutesPerSession <= 60 ? 5 : 6;
  const days = Array.from({ length: input.daysPerWeek }, (_, dayIndex) => ({
    day: dayIndex + 1,
    title: dayNames[dayIndex] ?? `Session ${dayIndex + 1}`,
    focus: dayNames[dayIndex] ?? 'Balanced development',
    exercises: Array.from({ length: Math.min(exercisesPerDay, options.length) }, (_, exerciseIndex) => {
      const exercise = options[(dayIndex * 2 + exerciseIndex) % options.length];
      return {
        name: exercise.name,
        sets: exercise.sets,
        reps: exercise.reps ? `${Math.max(5, exercise.reps - 2)}–${exercise.reps + 2}` : '6–12',
        effort: dayIndex === 0 ? '2–3 RIR' : '1–3 RIR',
        restSeconds: exerciseIndex < 2 ? 150 : 90,
        note: exercise.note,
      };
    }),
  }));
  return {
    title: `${input.durationWeeks}-Week ${input.goal} Block`,
    goal: input.goal,
    durationWeeks: input.durationWeeks,
    daysPerWeek: input.daysPerWeek,
    minutesPerSession: input.minutesPerSession,
    overview: `A ${input.daysPerWeek}-day plan built from your most frequently logged Hevy movements, ${profile.experience} experience level, and ${input.minutesPerSession}-minute session limit.`,
    progression: 'Stay inside the rep range. When every working set reaches the top of the range with the target RIR, add the smallest practical load next exposure.',
    deload: `In week ${Math.max(4, input.durationWeeks)}, reduce working sets by roughly one third if performance, motivation, or recovery has deteriorated.`,
    days,
  };
}

export function programPrompt(input: ProgramRequest, profile: AthleteProfile, dashboard: DashboardData) {
  return `Create a complete training program as strict JSON only. Use this schema:
{"title":"string","goal":"string","durationWeeks":number,"daysPerWeek":number,"minutesPerSession":number,"overview":"string","progression":"string","deload":"string","days":[{"day":number,"title":"string","focus":"string","exercises":[{"name":"string","sets":number,"reps":"string","effort":"string","restSeconds":number,"note":"string"}]}]}

Request: ${JSON.stringify(input)}
Athlete profile: ${JSON.stringify(profile)}
Frequent Hevy exercises: ${JSON.stringify(dashboard.exerciseOptions)}
Weekly review: ${JSON.stringify(dashboard.weeklyReview)}

Respect the requested days, duration, goal, available equipment, limitations, and session time. Prefer familiar logged movements where appropriate. Return JSON only.`;
}

