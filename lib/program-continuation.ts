import type { DashboardData } from './hevy';
import type { ExerciseTemplate, HevyExercise, HevyWorkout } from './hevy-types';
import type { Muscle, MuscleOverride } from './muscles';
import { muscleLabel, resolveMuscles } from './muscles';
import type { ProgramRequest } from './program';
import { classifySet } from './sets';
import type {
  AthleteProfile,
  ProgramExercise,
  TrainingProgram,
} from './storage';
import { localWindowStart } from './time';

type Session = {
  workout: HevyWorkout;
  groupKey: string;
  groupLabel: string;
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeTitle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function loadIncrement(name: string, profile: AthleteProfile) {
  const lower = name.toLowerCase();
  if (/cable|pulldown|pushdown|crossover/.test(lower)) {
    return profile.loadIncrements.cable;
  }
  if (/machine|smith|hack|leg press/.test(lower)) {
    return profile.loadIncrements.machine;
  }
  if (/dumbbell|kettlebell/.test(lower)) {
    return profile.loadIncrements.dumbbell;
  }
  return profile.loadIncrements.barbell;
}

export function buildContinuationProgram(
  input: ProgramRequest,
  profile: AthleteProfile,
  dashboard: DashboardData,
  workouts: HevyWorkout[],
  templates: ExerciseTemplate[] = [],
  overrides: MuscleOverride[] = [],
  now = new Date(),
): Omit<TrainingProgram, 'id' | 'createdAt'> | null {
  const start = localWindowStart(now, 28, profile.timezone).getTime();
  const recent = workouts
    .filter((workout) => {
      const performedAt = new Date(workout.start_time).getTime();
      return performedAt >= start && performedAt <= now.getTime();
    })
    .sort(
      (a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
    );
  if (!recent.length) return null;

  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const overrideMap = new Map(
    overrides.map((item) => [item.exerciseTemplateId, item]),
  );
  const classified = (exercise: HevyExercise) =>
    exercise.sets.map((set) => {
      const template = templateMap.get(exercise.exercise_template_id);
      return classifySet(set, {
        title: exercise.title,
        equipment: template?.equipment,
        primary_muscle_group: template?.primary_muscle_group,
      });
    });
  const workingSets = (exercise: HevyExercise) =>
    classified(exercise).reduce(
      (sum, set) => sum + set.countsAsWorking,
      0,
    );
  const muscleFor = (exercise: HevyExercise) =>
    resolveMuscles(
      templateMap.get(exercise.exercise_template_id) ?? {
        id: exercise.exercise_template_id,
        title: exercise.title,
        is_custom: true,
      },
      overrideMap.get(exercise.exercise_template_id),
    ).primary;

  const titleCounts = new Map<string, number>();
  for (const workout of recent) {
    const title = normalizeTitle(workout.title);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const genericTitle = (title: string) =>
    !title || /^(?:workout|training|gym|session)(?: \d+)?$/.test(title);
  const reusableTitles =
    [...titleCounts].filter(([title]) => !genericTitle(title)).length >=
      input.daysPerWeek &&
    [...titleCounts.values()].some((count) => count > 1);

  const sessions: Session[] = recent.map((workout) => {
    if (reusableTitles) {
      const key = normalizeTitle(workout.title);
      return { workout, groupKey: `title:${key}`, groupLabel: workout.title };
    }
    const counts = new Map<Muscle, number>();
    for (const exercise of workout.exercises) {
      const sets = workingSets(exercise);
      if (sets <= 0) continue;
      const muscle = muscleFor(exercise);
      counts.set(muscle, (counts.get(muscle) ?? 0) + sets);
    }
    const dominant = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([muscle]) => muscle)
      .sort();
    const key = dominant.join('+') || 'unclassified';
    return {
      workout,
      groupKey: `muscle:${key}`,
      groupLabel: dominant.map((muscle) => muscleLabel(muscle)).join(' + '),
    };
  });

  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const group = groups.get(session.groupKey) ?? [];
    group.push(session);
    groups.set(session.groupKey, group);
  }
  const selected = [...groups.values()]
    .filter((group) => {
      if (group[0].groupKey === 'muscle:unclassified') return false;
      if (!reusableTitles) return true;
      return !genericTitle(group[0].groupKey.slice('title:'.length));
    })
    .sort(
      (a, b) =>
        b.length - a.length ||
        new Date(b[0].workout.start_time).getTime() -
          new Date(a[0].workout.start_time).getTime(),
    )
    .slice(0, input.daysPerWeek);
  if (selected.length < input.daysPerWeek) return null;

  const stateFor = (templateId: string) => {
    const stat = dashboard.exerciseStats.find(
      (item) => item.exerciseTemplateId === templateId,
    );
    return dashboard.progressionStates.find(
      (state) =>
        state.exerciseTemplateId === templateId ||
        Boolean(stat?.slotId && state.slotId === stat.slotId),
    );
  };

  const days = selected.map((group, dayIndex) => {
    const templateSession = group[0];
    const exercises = templateSession.workout.exercises
      .map((exercise, exerciseIndex): ProgramExercise | null => {
        if (workingSets(exercise) <= 0) return null;
        const state = stateFor(exercise.exercise_template_id);
        const stat = dashboard.exerciseStats.find(
          (item) =>
            item.exerciseTemplateId === exercise.exercise_template_id,
        );
        const setHistory = group.flatMap((session) =>
          session.workout.exercises
            .filter(
              (item) =>
                item.exercise_template_id === exercise.exercise_template_id,
            )
            .map(workingSets),
        );
        let sets = Math.max(1, Math.round(median(setHistory)));
        const repRange: [number, number] = state?.targetRepRange ?? [6, 12];
        const increment = loadIncrement(exercise.title, profile);
        let startingLoadKg = state?.modalLoadKg || null;
        let note = 'Continue the recent movement with clean, repeatable reps.';
        if (state?.recommendation === 'add_load' && startingLoadKg !== null) {
          startingLoadKg += increment;
          note = 'Add the smallest practical load and rebuild inside the range.';
        } else if (state?.recommendation === 'add_reps') {
          note = `Keep the load stable and target ${repRange[1]} reps on every set.`;
        } else if (
          state?.recommendation === 'reduce_load' &&
          startingLoadKg !== null
        ) {
          startingLoadKg = Math.round(startingLoadKg * 0.925 * 100) / 100;
          note = 'Reduce the load by about 7.5% and restore clean reps.';
        } else if (state?.recommendation === 'reduce_volume') {
          sets = Math.max(2, sets - 1);
          note = 'Use one fewer working set while performance recovers.';
        } else if (state?.recommendation === 'swap_or_rotate') {
          note =
            'Consider a variation; no automatic swap in continuation mode.';
        }
        return {
          exerciseTemplateId: exercise.exercise_template_id,
          slotId: state?.slotId ?? stat?.slotId ?? null,
          name: exercise.title,
          sets,
          repRange,
          effort: { type: 'rir', value: [1, 3] },
          restSeconds: exerciseIndex < 2 ? 150 : 90,
          startingLoadKg,
          progression: {
            rule: 'double_progression',
            loadIncrementKg: increment,
            triggerReps: repRange[1],
          },
          note,
          rationale:
            state?.rationale ??
            'Continued from a session logged during the last four weeks.',
        };
      })
      .filter((exercise): exercise is ProgramExercise => exercise !== null);
    return {
      day: dayIndex + 1,
      title: reusableTitles
        ? templateSession.workout.title
        : titleCase(templateSession.groupLabel),
      focus: templateSession.groupLabel || templateSession.workout.title,
      exercises,
    };
  });
  if (days.some((day) => day.exercises.length === 0)) return null;

  return {
    schemaVersion: 2,
    title: `${input.durationWeeks}-Week ${input.goal} Continuation`,
    goal: input.goal,
    durationWeeks: input.durationWeeks,
    daysPerWeek: input.daysPerWeek,
    minutesPerSession: input.minutesPerSession,
    overview:
      'Continuation of your last four weeks with progression rules applied. The AI provider was unavailable; regenerate later for a redesigned block.',
    progression:
      'Build reps inside each range, then add the listed practical load increment.',
    deload:
      'Reduce hard sets when performance and recovery deteriorate together.',
    days,
  };
}
