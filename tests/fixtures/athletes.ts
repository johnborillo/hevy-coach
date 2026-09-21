import type {
  ExerciseTemplate,
  HevyExercise,
  HevySet,
  HevyWorkout,
} from '../../lib/hevy-types';

const DAY = 86_400_000;
const WEEK = DAY * 7;
const WEEKS = 26;
const LATEST_WEEK_START = Date.parse('2026-09-14T12:00:00.000Z');

export const FIXTURE_NOW = new Date('2026-09-21T12:00:00.000Z');

export type AthleteFixture = {
  athleteName: string;
  description: string;
  now: Date;
  plannedDaysPerWeek: number;
  templates: ExerciseTemplate[];
  workouts: HevyWorkout[];
};

export const EXERCISE_TEMPLATES: ExerciseTemplate[] = [
  {
    id: 'bench-barbell',
    title: 'Bench Press (Barbell)',
    primary_muscle_group: 'chest',
    secondary_muscle_groups: ['triceps', 'shoulders'],
    equipment: 'barbell',
  },
  {
    id: 'incline-dumbbell',
    title: 'Incline Bench Press (Dumbbell)',
    primary_muscle_group: 'chest',
    secondary_muscle_groups: ['triceps', 'shoulders'],
    equipment: 'dumbbell',
  },
  {
    id: 'incline-barbell',
    title: 'Incline Bench Press (Barbell)',
    primary_muscle_group: 'chest',
    secondary_muscle_groups: ['triceps', 'shoulders'],
    equipment: 'barbell',
  },
  {
    id: 'overhead-press',
    title: 'Overhead Press (Barbell)',
    primary_muscle_group: 'shoulders',
    secondary_muscle_groups: ['triceps'],
    equipment: 'barbell',
  },
  {
    id: 'squat-barbell',
    title: 'Squat (Barbell)',
    primary_muscle_group: 'quadriceps',
    secondary_muscle_groups: ['glutes', 'hamstrings'],
    equipment: 'barbell',
  },
  {
    id: 'romanian-deadlift',
    title: 'Romanian Deadlift (Barbell)',
    primary_muscle_group: 'hamstrings',
    secondary_muscle_groups: ['glutes', 'lower_back'],
    equipment: 'barbell',
  },
  {
    id: 'seated-row',
    title: 'Seated Row (Machine)',
    primary_muscle_group: 'upper_back',
    secondary_muscle_groups: ['biceps', 'lats'],
    equipment: 'machine',
  },
  {
    id: 'lat-pulldown',
    title: 'Lat Pulldown (Cable)',
    primary_muscle_group: 'lats',
    secondary_muscle_groups: ['biceps', 'upper_back'],
    equipment: 'cable',
  },
  {
    id: 'lateral-raise',
    title: 'Lateral Raise (Dumbbell)',
    primary_muscle_group: 'shoulders',
    equipment: 'dumbbell',
  },
  {
    id: 'leg-curl',
    title: 'Seated Leg Curl (Machine)',
    primary_muscle_group: 'hamstrings',
    equipment: 'machine',
  },
  {
    id: 'calf-raise',
    title: 'Standing Calf Raise (Machine)',
    primary_muscle_group: 'calves',
    equipment: 'machine',
  },
  {
    id: 'pull-up',
    title: 'Pull Up',
    primary_muscle_group: 'lats',
    secondary_muscle_groups: ['biceps', 'upper_back'],
    equipment: 'bodyweight',
  },
];

const templateById = new Map(
  EXERCISE_TEMPLATES.map((template) => [template.id, template]),
);

function sets(
  weightKg: number,
  reps: number,
  count: number,
  rpe: number,
  lastType: string = 'normal',
): HevySet[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    type: index === count - 1 ? lastType : 'normal',
    weight_kg: weightKg,
    reps: Math.max(1, reps - (index === count - 1 ? 1 : 0)),
    rpe: Math.min(10, rpe + index * 0.25),
  }));
}

function exercise(
  templateId: string,
  weightKg: number,
  reps: number,
  count = 3,
  rpe = 8,
  lastType = 'normal',
): HevyExercise {
  const template = templateById.get(templateId);
  if (!template) throw new Error(`Unknown fixture template: ${templateId}`);
  return {
    title: template.title,
    exercise_template_id: template.id,
    sets: sets(weightKg, reps, count, rpe, lastType),
  };
}

function workout(
  athlete: string,
  weekIndex: number,
  dayOffset: number,
  title: string,
  exercises: HevyExercise[],
  durationMinutes = 60,
): HevyWorkout {
  const start = new Date(
    LATEST_WEEK_START - (WEEKS - 1 - weekIndex) * WEEK + dayOffset * DAY,
  );
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    id: `${athlete}-${String(weekIndex + 1).padStart(2, '0')}-${dayOffset}`,
    title,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    description: '',
    updated_at: end.toISOString(),
    exercises,
  };
}

function noviceWorkouts() {
  return Array.from({ length: WEEKS }, (_, week) => {
    const squatLoad = 55 + week * 1.25;
    const pressLoad = 37.5 + week;
    const pullLoad = 40 + week;
    return [
      workout('novice', week, 0, 'Full Body A', [
        exercise('squat-barbell', squatLoad, 6),
        exercise('bench-barbell', pressLoad, 7),
        exercise('seated-row', pullLoad, 9),
      ]),
      workout('novice', week, 2, 'Full Body B', [
        exercise('romanian-deadlift', squatLoad, 8),
        exercise('overhead-press', pressLoad * 0.7, 8),
        exercise('lat-pulldown', pullLoad, 10),
      ]),
      workout('novice', week, 4, 'Full Body C', [
        exercise('squat-barbell', squatLoad, 7),
        exercise('bench-barbell', pressLoad, 8),
        exercise('calf-raise', 45 + week, 12),
      ]),
    ];
  }).flat();
}

function intermediateWorkouts() {
  return Array.from({ length: WEEKS }, (_, week) => {
    const loadStep = Math.floor(week / 4);
    const reps = 8 + (week % 4);
    return [
      workout('intermediate', week, 0, 'Upper A', [
        exercise('bench-barbell', 70 + loadStep * 2.5, reps, 4, 8 + week / 80),
        exercise('seated-row', 65 + loadStep * 2.5, reps + 1, 4, 8),
        exercise('lateral-raise', 10 + Math.floor(week / 8), 12, 3, 9),
      ]),
      workout('intermediate', week, 1, 'Lower A', [
        exercise('squat-barbell', 100 + loadStep * 2.5, reps, 4, 8.25),
        exercise('leg-curl', 45 + loadStep * 2.5, reps + 2, 3, 8.5),
        exercise('calf-raise', 70 + loadStep * 2.5, 12, 4, 8.5),
      ]),
      workout('intermediate', week, 3, 'Upper B', [
        exercise('incline-dumbbell', 30 + loadStep, reps, 3, 8.5),
        exercise('lat-pulldown', 65 + loadStep * 2.5, reps + 1, 4, 8.5),
        exercise('overhead-press', 45 + loadStep * 2.5, reps, 3, 8.75),
      ]),
      workout('intermediate', week, 5, 'Lower B', [
        exercise('romanian-deadlift', 90 + loadStep * 2.5, reps, 4, 8.5),
        exercise('squat-barbell', 85 + loadStep * 2.5, reps + 2, 3, 8),
        exercise('leg-curl', 42.5 + loadStep * 2.5, reps + 3, 3, 9),
      ]),
    ];
  }).flat();
}

function advancedWorkouts() {
  return Array.from({ length: WEEKS }, (_, week) => {
    const deload = week === 20;
    const setCount = deload ? 2 : 4;
    const loadFactor = deload ? 0.82 : 1;
    const pressTemplate = week < 18 ? 'incline-dumbbell' : 'incline-barbell';
    const pressLoad = (week < 18 ? 38 + Math.floor(week / 6) : 82.5) * loadFactor;
    const rpe = deload ? 6.5 : 8.5 + (week % 4) * 0.25;
    return [
      workout('advanced', week, 0, 'Push', [
        exercise(pressTemplate, pressLoad, 8 + (week % 3), setCount, rpe),
        exercise('overhead-press', 57.5 * loadFactor, 7, setCount, rpe),
        exercise(
          'lateral-raise',
          14 * loadFactor,
          13,
          deload ? 2 : 3,
          rpe,
          deload ? 'normal' : 'dropset',
        ),
      ]),
      workout('advanced', week, 1, 'Pull', [
        exercise('pull-up', 10, 8 + (week % 2), setCount, rpe),
        exercise('seated-row', 90 * loadFactor, 8, setCount, rpe),
        exercise('lat-pulldown', 82.5 * loadFactor, 9, setCount, rpe),
      ]),
      workout('advanced', week, 2, 'Legs', [
        exercise('squat-barbell', 145 * loadFactor, 6, setCount, rpe),
        exercise('romanian-deadlift', 132.5 * loadFactor, 7, setCount, rpe),
        exercise('leg-curl', 67.5 * loadFactor, 10, setCount, rpe),
      ]),
      workout('advanced', week, 4, 'Upper', [
        exercise('bench-barbell', 112.5 * loadFactor, 6, setCount, rpe),
        exercise('seated-row', 87.5 * loadFactor, 9, setCount, rpe),
        exercise('lateral-raise', 14 * loadFactor, 14, 3, rpe),
      ]),
      workout('advanced', week, 5, 'Lower', [
        exercise('squat-barbell', 125 * loadFactor, 8, setCount, rpe),
        exercise('romanian-deadlift', 120 * loadFactor, 9, setCount, rpe),
        exercise('calf-raise', 110 * loadFactor, 10, setCount, rpe),
      ]),
    ];
  }).flat();
}

export const ATHLETE_FIXTURES: Record<string, AthleteFixture> = {
  novice: {
    athleteName: 'Fixture Novice',
    description: 'Three weekly full-body sessions with steady linear loading.',
    now: FIXTURE_NOW,
    plannedDaysPerWeek: 3,
    templates: EXERCISE_TEMPLATES,
    workouts: noviceWorkouts(),
  },
  intermediate: {
    athleteName: 'Fixture Intermediate',
    description: 'Four weekly sessions using repeatable double progression.',
    now: FIXTURE_NOW,
    plannedDaysPerWeek: 4,
    templates: EXERCISE_TEMPLATES,
    workouts: intermediateWorkouts(),
  },
  advanced: {
    athleteName: 'Fixture Advanced',
    description:
      'Five weekly sessions with a variation change, dropsets, and a planned deload pattern.',
    now: FIXTURE_NOW,
    plannedDaysPerWeek: 5,
    templates: EXERCISE_TEMPLATES,
    workouts: advancedWorkouts(),
  },
};
