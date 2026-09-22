import {
  createAnalysisMetadata,
  type AnalysisMetadata,
} from './analysis-contracts';
import type {
  HevyExercise,
  ExerciseTemplate,
  HevySet,
  HevyWorkout,
} from './hevy-types';
import { deserializeHevyTemplate } from './hevy-store';
import {
  MUSCLES,
  muscleLabel,
  resolveMuscles,
  type Muscle,
  type MuscleOverride,
} from './muscles';
import {
  computeProgression,
  type ProgressionSession,
  type ProgressionState,
} from './progression';
import { suggestSlots, type ExerciseSlot, type SlotSuggestion } from './slots';
import { classifySet } from './sets';
import {
  detectRecords,
  selectRecentRecords,
  type PersonalRecord,
  type RecordKind,
} from './records';
import {
  computeAdherence,
  computeBalance,
  computeMuscleAudit,
  type AdherenceWeek,
  type BalanceSignal,
} from './audit';

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
  key: Muscle;
  name: string;
  sets: number;
  indirectSets: number;
  previousSets: number;
  volumeKg: number;
  sessionsHit: number;
  fourWeekAvgDirect: number;
  bandLabel: 'zero' | 'low' | 'moderate' | 'high' | 'very_high';
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
    adherencePct: number;
    plannedSessionsPerWeek: number;
    volumeChangePercent: number;
  };
  muscles: MuscleDistribution[];
  muscleWindows: Record<MuscleWindow, MuscleDistribution[]>;
  unmappedExercises: Array<{ id: string; title: string }>;
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
  adherenceWeeks: AdherenceWeek[];
  balance: BalanceSignal[];
  records: Array<{
    exercise: string;
    date: string;
    valueKg: number;
    reps: number;
    weightKg: number;
    kind: RecordKind;
    previousValue: number | null;
    previousDate: string | null;
    scope: PersonalRecord['scope'];
  }>;
  exerciseStats: Array<{
    exerciseTemplateId: string;
    slotId: string | null;
    slotName: string | null;
    exercise: string;
    muscle: string;
    sessions: number;
    workingSets: number;
    volumeKg: number;
    bestE1rmKg: number;
    change: number;
    progressionStatus: ProgressionState['status'];
    progressionRecommendation: ProgressionState['recommendation'];
    progressionRationale: string;
    modalLoadKg: number;
    targetRepRange: [number, number] | null;
    repsAtModalLoad: number[];
    lastSetRpe: number[];
  }>;
  progressionStates: ProgressionState[];
  exerciseSlots: ExerciseSlot[];
  slotSuggestions: SlotSuggestion[];
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

function daysAgo(iso: string, nowMs = Date.now()) {
  return (nowMs - new Date(iso).getTime()) / DAY;
}

function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function durationMinutes(workout: HevyWorkout) {
  return Math.max(
    0,
    (new Date(workout.end_time).getTime() -
      new Date(workout.start_time).getTime()) /
      60_000,
  );
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
  muscleOverrides: MuscleOverride[] = [],
  exerciseSlots: ExerciseSlot[] = [],
  plannedDaysPerWeek = 4,
): DashboardData {
  const nowMs = now.getTime();
  const sorted = [...workouts].sort(
    (a, b) =>
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  );
  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const overrideMap = new Map(
    muscleOverrides.map((item) => [item.exerciseTemplateId, item]),
  );
  const slotMap = new Map(exerciseSlots.map((slot) => [slot.id, slot]));
  const slotForTemplate = (templateId: string) => {
    const slotId = overrideMap.get(templateId)?.slotId ?? null;
    return slotId ? (slotMap.get(slotId) ?? null) : null;
  };
  const resolvedFor = (exercise: HevyExercise) =>
    resolveMuscles(
      templateMap.get(exercise.exercise_template_id) ?? {
        id: exercise.exercise_template_id,
        title: exercise.title,
        is_custom: true,
      },
      overrideMap.get(exercise.exercise_template_id),
    );
  const classify = (exercise: HevyExercise, set: HevySet) => {
    const template = templateMap.get(exercise.exercise_template_id);
    return classifySet(set, {
      title: exercise.title,
      equipment: template?.equipment,
      primary_muscle_group: template?.primary_muscle_group,
    });
  };
  const exerciseWorkingSets = (exercise: HevyExercise) =>
    exercise.sets.reduce(
      (sum, set) => sum + classify(exercise, set).countsAsWorking,
      0,
    );
  const exerciseVolume = (exercise: HevyExercise) =>
    exercise.sets.reduce(
      (sum, set) => sum + (classify(exercise, set).loadVolumeKg ?? 0),
      0,
    );
  const workoutWorkingSets = (workout: HevyWorkout) =>
    workout.exercises.reduce(
      (sum, exercise) => sum + exerciseWorkingSets(exercise),
      0,
    );
  const workoutVolume = (workout: HevyWorkout) =>
    workout.exercises.reduce(
      (sum, exercise) => sum + exerciseVolume(exercise),
      0,
    );
  const recent30 = sorted.filter(
    (workout) => daysAgo(workout.start_time, nowMs) <= 30,
  );
  const recent7 = sorted.filter(
    (workout) => daysAgo(workout.start_time, nowMs) <= 7,
  );
  const previous7 = sorted.filter(
    (workout) =>
      daysAgo(workout.start_time, nowMs) > 7 &&
      daysAgo(workout.start_time, nowMs) <= 14,
  );
  const countSets = (items: HevyWorkout[]) =>
    items.reduce((sum, workout) => sum + workoutWorkingSets(workout), 0);
  const totalVolume = (items: HevyWorkout[]) =>
    items.reduce((sum, workout) => sum + workoutVolume(workout), 0);
  const workingSets7d = countSets(recent7);
  const volume7d = totalVolume(recent7);
  const previousVolume7d = totalVolume(previous7);
  const totalMinutes = recent30.reduce(
    (sum, workout) => sum + durationMinutes(workout),
    0,
  );
  const auditObservations = sorted.flatMap((workout) =>
    workout.exercises.flatMap((exercise) => {
      const resolved = resolvedFor(exercise);
      const overrideWeight =
        overrideMap.get(exercise.exercise_template_id)?.countsAs ?? 1;
      const countsAsWorking =
        exerciseWorkingSets(exercise) * overrideWeight;
      return countsAsWorking > 0
        ? [
            {
              workoutId: workout.id,
              performedAt: workout.start_time,
              primary: resolved.primary,
              secondary: resolved.secondary,
              countsAsWorking,
            },
          ]
        : [];
    }),
  );
  const auditWindows = {
    '7': computeMuscleAudit(auditObservations, now, 7),
    '14': computeMuscleAudit(auditObservations, now, 14),
    '30': computeMuscleAudit(auditObservations, now, 30),
  } as const;
  const fourWeekAudit = computeMuscleAudit(auditObservations, now, 28);
  const balance = computeBalance(fourWeekAudit);
  const adherenceWeeks = computeAdherence(
    sorted.map((workout) => ({ id: workout.id, performedAt: workout.start_time })),
    plannedDaysPerWeek,
    now,
  );
  const adherencePct = adherenceWeeks.length
    ? Math.round(
        (adherenceWeeks.reduce((sum, week) => sum + week.adherencePct, 0) /
          adherenceWeeks.length) *
          10,
      ) / 10
    : 0;

  const muscleDistribution = (windowDays: number) => {
    const current = new Map<
      Muscle,
      { directSets: number; indirectSets: number; volumeKg: number }
    >();
    const previous = new Map<Muscle, number>();

    for (const workout of sorted) {
      const age = daysAgo(workout.start_time, nowMs);
      const inCurrentWindow = age >= 0 && age <= windowDays;
      const inPreviousWindow = age > windowDays && age <= windowDays * 2;
      if (!inCurrentWindow && !inPreviousWindow) continue;

      for (const exercise of workout.exercises) {
        const resolved = resolvedFor(exercise);
        const overrideWeight =
          overrideMap.get(exercise.exercise_template_id)?.countsAs ?? 1;
        const workingSets = exerciseWorkingSets(exercise) * overrideWeight;
        if (inCurrentWindow) {
          const value = current.get(resolved.primary) ?? {
            directSets: 0,
            indirectSets: 0,
            volumeKg: 0,
          };
          value.directSets += workingSets;
          value.volumeKg += exerciseVolume(exercise) * overrideWeight;
          current.set(resolved.primary, value);
          for (const secondary of resolved.secondary) {
            const secondaryValue = current.get(secondary) ?? {
              directSets: 0,
              indirectSets: 0,
              volumeKg: 0,
            };
            secondaryValue.indirectSets += workingSets * 0.5;
            current.set(secondary, secondaryValue);
          }
        } else {
          previous.set(
            resolved.primary,
            (previous.get(resolved.primary) ?? 0) + workingSets,
          );
        }
      }
    }

    const audit = auditWindows[String(windowDays) as MuscleWindow];
    const auditMap = new Map(audit.map((item) => [item.muscle, item]));
    return MUSCLES.map((muscle) => {
      const value = current.get(muscle) ?? {
        directSets: 0,
        indirectSets: 0,
        volumeKg: 0,
      };
      const auditValue = auditMap.get(muscle);
      return {
        key: muscle,
        name: muscleLabel(muscle),
        sets: value.directSets,
        indirectSets: value.indirectSets,
        previousSets: previous.get(muscle) ?? 0,
        volumeKg: Math.round(value.volumeKg),
        sessionsHit: auditValue?.sessionsHit ?? 0,
        fourWeekAvgDirect: auditValue?.fourWeekAvgDirect ?? 0,
        bandLabel: auditValue?.bandLabel ?? 'zero',
      };
    }).sort(
      (a, b) =>
        b.sets - a.sets ||
        b.indirectSets - a.indirectSets ||
        a.name.localeCompare(b.name),
    );
  };

  const muscleWindows: Record<MuscleWindow, MuscleDistribution[]> = {
    '7': muscleDistribution(7),
    '14': muscleDistribution(14),
    '30': muscleDistribution(30),
  };
  const muscles = muscleWindows['7'];
  const unmappedExercises = [
    ...new Map(
      sorted
        .flatMap((workout) => workout.exercises)
        .filter((exercise) => resolvedFor(exercise).unmapped)
        .map((exercise) => [
          exercise.exercise_template_id,
          { id: exercise.exercise_template_id, title: exercise.title },
        ]),
    ).values(),
  ].sort((a, b) => a.title.localeCompare(b.title));

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
  const exerciseTotals = new Map<
    string,
    { title: string; sessions: number; sets: number; volumeKg: number }
  >();
  const progressionSessions = new Map<string, ProgressionSession[]>();
  const progressionSubjectSlots = new Map<string, ExerciseSlot | null>();
  const progressionSubjectTemplates = new Map<string, string>();
  for (const workout of sorted) {
    for (const exercise of workout.exercises) {
      const working = exercise.sets
        .map((set) => ({ set, classified: classify(exercise, set) }))
        .filter((item) => item.classified.countsAsWorking > 0);
      const total = exerciseTotals.get(exercise.exercise_template_id) ?? {
        title: exercise.title,
        sessions: 0,
        sets: 0,
        volumeKg: 0,
      };
      total.sessions += 1;
      total.sets += working.reduce(
        (sum, item) => sum + item.classified.countsAsWorking,
        0,
      );
      total.volumeKg += working.reduce(
        (sum, item) => sum + (item.classified.loadVolumeKg ?? 0),
        0,
      );
      exerciseTotals.set(exercise.exercise_template_id, total);
      if (working.length) {
        const slot = slotForTemplate(exercise.exercise_template_id);
        const subjectId = slot?.id ?? exercise.exercise_template_id;
        const sessions = progressionSessions.get(subjectId) ?? [];
        sessions.push({
          performedAt: workout.start_time,
          sets: working.map((item) => item.classified),
          exerciseTemplateId: exercise.exercise_template_id,
          exerciseTitle: exercise.title,
        });
        progressionSessions.set(subjectId, sessions);
        progressionSubjectSlots.set(subjectId, slot);
        progressionSubjectTemplates.set(
          subjectId,
          exercise.exercise_template_id,
        );
      }
      const candidates = working
        .map(({ set, classified }) => ({ set, value: classified.e1rmKg }))
        .filter(
          (item) => item.value !== null && item.set.reps && item.set.weight_kg,
        )
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

  const progressionStates = [...progressionSessions.entries()]
    .map(([subjectId, sessions]) => {
      const slot = progressionSubjectSlots.get(subjectId) ?? null;
      const representativeTemplateId =
        progressionSubjectTemplates.get(subjectId) ?? subjectId;
      return computeProgression(
        representativeTemplateId,
        slot?.name ?? sessions.at(-1)?.exerciseTitle ?? 'Unknown exercise',
        sessions,
        { slotId: slot?.id ?? null },
      );
    })
    .sort(
      (a, b) =>
        new Date(b.lastPerformedAt).getTime() -
        new Date(a.lastPerformedAt).getTime(),
    );
  const progressionBySubjectId = new Map(
    progressionStates.map((state) => [
      state.slotId ?? state.exerciseTemplateId,
      state,
    ]),
  );
  const progressionByTemplateId = new Map(
    [...exerciseTotals.keys()].map((templateId) => {
      const slot = slotForTemplate(templateId);
      return [
        templateId,
        progressionBySubjectId.get(slot?.id ?? templateId),
      ] as const;
    }),
  );

  const strengthTrends = [...histories.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, history]) => {
      const chronological = [...history].reverse().slice(-8);
      const points = chronological.map((point) => ({
        date: point.date,
        value: Math.round(point.value * 10) / 10,
        label: formatShortDate(point.date),
      }));
      return {
        exercise: history[0].title,
        change: progressionByTemplateId.get(id)?.performanceSlopePct ?? 0,
        bestKg:
          Math.round(Math.max(...history.map((item) => item.value)) * 10) / 10,
        points,
      };
    });
  const trend = strengthTrends[0] ?? {
    exercise: 'No weighted lift yet',
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

  const personalRecords = detectRecords(
    sorted,
    templates,
    muscleOverrides,
    exerciseSlots,
  );
  const records = selectRecentRecords(personalRecords, now, { limit: 5 }).map(
    (record) => ({
      exercise: record.exercise,
      date: formatShortDate(record.performedAt),
      valueKg:
        record.kind === 'reps_at_load' ? record.loadKg : record.value,
      reps: record.reps,
      weightKg: record.loadKg,
      kind: record.kind,
      previousValue: record.previousValue,
      previousDate: record.previousAt
        ? formatShortDate(record.previousAt)
        : null,
      scope: record.scope,
    }),
  );

  const exerciseStats = [...exerciseTotals.entries()]
    .map(([id, totals]) => {
      const history = histories.get(id) ?? [];
      return {
        exerciseTemplateId: id,
        exercise: totals.title,
        muscle: muscleLabel(
          resolveMuscles(
            templateMap.get(id) ?? {
              id,
              title: totals.title,
              is_custom: true,
            },
            overrideMap.get(id),
          ).primary,
        ),
        sessions: totals.sessions,
        workingSets: totals.sets,
        volumeKg: Math.round(totals.volumeKg),
        bestE1rmKg: history.length
          ? Math.round(Math.max(...history.map((point) => point.value)) * 10) /
            10
          : 0,
        change: progressionByTemplateId.get(id)?.performanceSlopePct ?? 0,
        slotId: slotForTemplate(id)?.id ?? null,
        slotName: slotForTemplate(id)?.name ?? null,
        progressionStatus:
          progressionByTemplateId.get(id)?.status ?? 'insufficient_data',
        progressionRecommendation:
          progressionByTemplateId.get(id)?.recommendation ?? 'none',
        progressionRationale:
          progressionByTemplateId.get(id)?.rationale ??
          'No comparable working-set history is available yet.',
        modalLoadKg: progressionByTemplateId.get(id)?.modalLoadKg ?? 0,
        targetRepRange: progressionByTemplateId.get(id)?.targetRepRange ?? null,
        repsAtModalLoad: progressionByTemplateId.get(id)?.repsAtModalLoad ?? [],
        lastSetRpe: progressionByTemplateId.get(id)?.lastSetRpe ?? [],
      };
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20);

  const exerciseOptions = exerciseStats.slice(0, 10).map((stat) => {
    const latestExercise = sorted
      .flatMap((workout) => workout.exercises)
      .find((exercise) => exercise.title === stat.exercise);
    const latestSets =
      latestExercise?.sets.filter(
        (set) => classify(latestExercise, set).countsAsWorking > 0,
      ) ?? [];
    const representative = latestSets.find((set) => set.weight_kg && set.reps);
    return {
      name: stat.exercise,
      muscle: stat.muscle,
      sets: Math.min(Math.max(latestSets.length, 2), 4),
      reps: representative?.reps ?? null,
      weightKg: representative?.weight_kg ?? null,
      note: 'Match the last clean effort; add a rep before load when possible.',
    };
  });

  const activeWeeks = workloadWeeks.filter((week) => week.sessions > 0).length;
  const consistencyPercent = Math.round(
    (activeWeeks / workloadWeeks.length) * 100,
  );
  const volumeChangePercent = percentChange(volume7d, previousVolume7d);
  const lastGap = sorted[0]
    ? Math.round(daysAgo(sorted[0].start_time, nowMs))
    : 0;
  const priorityProgression =
    progressionStates.find((state) => state.status === 'stalled') ??
    progressionStates.find((state) => state.status === 'regressing') ??
    progressionStates.find((state) => state.title === trend.exercise) ??
    progressionStates[0];
  const plateau = priorityProgression?.status === 'stalled';
  const biggestMuscle = [...muscles].sort((a, b) => b.sets - a.sets)[0];
  const lowestMuscle = [...muscles].sort((a, b) => a.sets - b.sets)[0];
  const weeklyReview = {
    label: `${formatShortDate(nowWeek.toISOString())}–${formatShortDate(new Date(nowWeek.getTime() + 6 * DAY).toISOString())}`,
    wins: [
      `${recent7.length} session${recent7.length === 1 ? '' : 's'} completed with ${workingSets7d} direct working sets.`,
      records.length
        ? `${records.length} estimated strength PR${records.length === 1 ? '' : 's'} appeared in the last 30 days.`
        : `${trend.exercise} is your clearest repeatable strength signal.`,
      volumeChangePercent > 0
        ? `Load-volume is up ${volumeChangePercent}% versus the previous seven days.`
        : `${activeWeeks} of the last eight weeks include training.`,
    ],
    watch: [
      volumeChangePercent > 35
        ? `Load-volume jumped ${volumeChangePercent}% week over week; monitor soreness and performance quality.`
        : `Weekly load-volume changed ${volumeChangePercent}% versus the prior week.`,
      biggestMuscle && lowestMuscle
        ? `${biggestMuscle.name} received ${biggestMuscle.sets} direct sets versus ${lowestMuscle.name} at ${lowestMuscle.sets}; confirm that this matches the goal.`
        : 'Muscle balance needs another complete week of data.',
    ],
    nextSteps: [
      plateau
        ? `${priorityProgression.title}: ${priorityProgression.rationale}`
        : priorityProgression
          ? `${priorityProgression.title}: ${priorityProgression.rationale}`
          : 'Repeat comparable working sets to establish a progression signal.',
      lastGap >= 7
        ? `Resume with fewer hard sets after the ${lastGap}-day gap.`
        : 'Keep the next session close to recent volume unless recovery says otherwise.',
    ],
  };

  return {
    analysis: createAnalysisMetadata(sorted, templates, now),
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
      activeWeeks,
      totalVolume30dKg: Math.round(totalVolume(recent30)),
      avgSessionMinutes: recent30.length
        ? Math.round(totalMinutes / recent30.length)
        : 0,
      consistencyPercent,
      adherencePct,
      plannedSessionsPerWeek: plannedDaysPerWeek,
      volumeChangePercent,
    },
    muscles,
    muscleWindows,
    unmappedExercises,
    trend: {
      exercise: trend.exercise,
      change: trend.change,
      points: trend.points,
    },
    strengthTrends,
    workloadWeeks,
    adherenceWeeks,
    balance,
    records,
    exerciseStats,
    progressionStates,
    exerciseSlots: exerciseSlots.map((slot) => ({
      ...slot,
      templateIds: [...slot.templateIds],
    })),
    slotSuggestions: suggestSlots(templates).filter(
      (suggestion) =>
        !suggestion.templateIds.every((templateId) =>
          slotForTemplate(templateId),
        ),
    ),
    recentWorkouts: sorted.slice(0, 8).map((workout) => ({
      title: workout.title,
      date: formatShortDate(workout.start_time),
      duration: `${Math.round(durationMinutes(workout))} min`,
      exercises: workout.exercises.length,
      workingSets: workoutWorkingSets(workout),
      volumeKg: Math.round(workoutVolume(workout)),
    })),
    calendarWorkouts: sorted.map((workout) => ({
      id: workout.id,
      title: workout.title,
      date: workout.start_time.slice(0, 10),
      time: formatTime(workout.start_time),
      durationMinutes: Math.round(durationMinutes(workout)),
      workingSets: workoutWorkingSets(workout),
      volumeKg: Math.round(workoutVolume(workout)),
      exercises: workout.exercises.map((exercise) => ({
        title: exercise.title,
        muscle: muscleLabel(resolvedFor(exercise).primary),
        sets: exercise.sets.map((set) => ({
          type: set.type ?? 'normal',
          weightKg: set.weight_kg ?? null,
          reps: set.reps ?? null,
          rpe: set.rpe ?? null,
        })),
      })),
    })),
    exerciseOptions,
    weeklyReview,
    insights: {
      plateau: priorityProgression
        ? `${priorityProgression.title} is ${priorityProgression.status.replace('_', ' ')}. ${priorityProgression.rationale}`
        : 'Repeat comparable working sets to establish a progression signal.',
      return:
        lastGap >= 14
          ? `Your last logged session was ${lastGap} days ago. Reduce working sets and leave several reps in reserve for the first week back.`
          : `Your latest logged session was ${lastGap} day${lastGap === 1 ? '' : 's'} ago, so the data does not indicate a long layoff.`,
      progress: `${trend.exercise} is the clearest current signal at ${trend.change >= 0 ? '+' : ''}${trend.change}%. Progress repeatable working sets, not one unusually hard top set.`,
    },
  };
}

function demoData(
  message = 'Add HEVY_API_KEY to switch from sample data',
): DashboardData {
  const points = [91.7, 92.5, 94.2, 94.5, 95.3, 96.1].map((value, index) => ({
    date: `2026-08-${index + 1}`,
    value,
    label: ['Jul 29', 'Aug 5', 'Aug 14', 'Aug 22', 'Aug 31', 'Sep 8'][index],
  }));
  const exerciseOptions: ExerciseOption[] = [
    ['Incline Bench Press', 'Chest', 3, 8, 65],
    ['Chest Supported Row', 'Upper Back', 3, 10, 55],
    ['Cable Lateral Raise', 'Shoulders', 3, 12, 9],
    ['Lat Pulldown', 'Lats', 3, 9, 59],
    ['Cable Triceps Extension', 'Triceps', 2, 12, 27],
    ['Incline Dumbbell Curl', 'Biceps', 2, 10, 12],
  ].map(([name, muscle, sets, reps, weightKg]) => ({
    name: String(name),
    muscle: String(muscle),
    sets: Number(sets),
    reps: Number(reps),
    weightKg: Number(weightKg),
    note: 'Match the last clean effort; add a rep before load.',
  }));
  const sampleExercises = [
    {
      title: 'Bench Press (Barbell)',
      muscle: 'Chest',
      sets: [
        { type: 'warmup', weightKg: 40, reps: 10, rpe: null },
        { type: 'normal', weightKg: 80, reps: 6, rpe: 8 },
        { type: 'normal', weightKg: 80, reps: 6, rpe: 8.5 },
        { type: 'normal', weightKg: 77.5, reps: 7, rpe: 9 },
      ],
    },
    {
      title: 'Chest Supported Row',
      muscle: 'Upper Back',
      sets: [
        { type: 'normal', weightKg: 55, reps: 10, rpe: 8 },
        { type: 'normal', weightKg: 55, reps: 10, rpe: 8 },
        { type: 'normal', weightKg: 55, reps: 9, rpe: 9 },
      ],
    },
    {
      title: 'Cable Lateral Raise',
      muscle: 'Shoulders',
      sets: [
        { type: 'normal', weightKg: 9, reps: 13, rpe: 8 },
        { type: 'normal', weightKg: 9, reps: 12, rpe: 9 },
      ],
    },
  ];
  const calendarWorkouts: CalendarWorkout[] = [
    {
      id: 'sample-upper-a',
      title: 'Upper A',
      date: '2026-09-08',
      time: '6:10 PM',
      durationMinutes: 54,
      workingSets: 8,
      volumeKg: 7420,
      exercises: sampleExercises,
    },
    {
      id: 'sample-lower-b',
      title: 'Lower B',
      date: '2026-09-06',
      time: '11:20 AM',
      durationMinutes: 62,
      workingSets: 7,
      volumeKg: 9860,
      exercises: [
        {
          title: 'Squat (Barbell)',
          muscle: 'Quadriceps',
          sets: [
            { type: 'warmup', weightKg: 70, reps: 6, rpe: null },
            { type: 'normal', weightKg: 118, reps: 5, rpe: 8 },
            { type: 'normal', weightKg: 118, reps: 5, rpe: 8.5 },
            { type: 'normal', weightKg: 115, reps: 6, rpe: 9 },
          ],
        },
        {
          title: 'Romanian Deadlift',
          muscle: 'Hamstrings',
          sets: [
            { type: 'normal', weightKg: 100, reps: 8, rpe: 8 },
            { type: 'normal', weightKg: 100, reps: 8, rpe: 8.5 },
            { type: 'normal', weightKg: 100, reps: 7, rpe: 9 },
          ],
        },
      ],
    },
    {
      id: 'sample-pull',
      title: 'Pull',
      date: '2026-09-04',
      time: '5:45 PM',
      durationMinutes: 48,
      workingSets: 8,
      volumeKg: 6250,
      exercises: sampleExercises.slice(1),
    },
    {
      id: 'sample-upper-b',
      title: 'Upper B',
      date: '2026-09-01',
      time: '6:05 PM',
      durationMinutes: 58,
      workingSets: 8,
      volumeKg: 8110,
      exercises: sampleExercises,
    },
  ];
  const muscles: MuscleDistribution[] = [
    ['chest_mid_lower', 'Chest', 10, 8, 8240],
    ['upper_back', 'Upper Back', 9, 9, 7120],
    ['quads', 'Quadriceps', 8, 6, 9630],
    ['delts_side', 'Shoulders', 7, 8, 2980],
    ['hamstrings', 'Hamstrings', 5, 5, 4310],
    ['biceps', 'Biceps', 4, 4, 1240],
  ].map(([key, name, sets, previousSets, volumeKg]) => ({
    key: key as Muscle,
    name: String(name),
    sets: Number(sets),
    indirectSets: 0,
    previousSets: Number(previousSets),
    volumeKg: Number(volumeKg),
    sessionsHit: Math.max(1, Math.round(Number(sets) / 2)),
    fourWeekAvgDirect: Number(sets),
    bandLabel: Number(sets) >= 9 ? ('high' as const) : ('moderate' as const),
  }));
  const scaleMuscles = (setMultiplier: number, volumeMultiplier: number) =>
    muscles.map((muscle) => ({
      ...muscle,
      sets: Math.round(muscle.sets * setMultiplier),
      previousSets: Math.round(muscle.previousSets * setMultiplier),
      volumeKg: Math.round(muscle.volumeKg * volumeMultiplier),
      sessionsHit: Math.max(1, Math.round(muscle.sessionsHit * setMultiplier)),
      fourWeekAvgDirect: Math.round(
        muscle.fourWeekAvgDirect * setMultiplier * 10,
      ) / 10,
    }));
  const demoBalance = computeBalance(
    muscles.map((muscle) => ({
      muscle: muscle.key,
      name: muscle.name,
      directSets: muscle.fourWeekAvgDirect,
      indirectSets: muscle.indirectSets,
      sessionsHit: muscle.sessionsHit,
      previousDirectSets: muscle.previousSets,
      fourWeekAvgDirect: muscle.fourWeekAvgDirect,
      bandLabel: muscle.bandLabel,
    })),
  );
  const sampleProgression = (
    exerciseTemplateId: string,
    title: string,
    status: ProgressionState['status'],
    recommendation: ProgressionState['recommendation'],
    performanceSlopePct: number,
  ): ProgressionState => ({
    exerciseTemplateId,
    slotId: null,
    title,
    variationChangeAt: null,
    sessionsAnalyzed: 6,
    lastPerformedAt: '2026-09-08T18:10:00.000Z',
    modalLoadKg: title.includes('Squat') ? 118 : 80,
    repsAtModalLoad: [6, 6, 7, 7, 8, 8],
    targetRepRange: [6, 8],
    rpeCoverage: 0.83,
    lastSetRpe: [8, 8, 8.5, 8.5, 9, 9],
    rpeSlope: 0.2,
    performanceIndex: points.map((point) => point.value),
    performanceSlopePct,
    sessionsSinceImprovement: status === 'stalled' ? 4 : 1,
    status,
    recommendation,
    rationale:
      recommendation === 'add_load'
        ? 'Recent performance is improving and the top of the rep range has been reached.'
        : recommendation === 'add_reps'
          ? 'Performance is improving; keep the load stable and build reps before adding weight.'
          : 'Performance is stable; keep the current exposure and reassess after another session.',
  });
  const progressionStates = [
    sampleProgression(
      'sample-bench',
      'Bench Press (Barbell)',
      'progressing',
      'add_load',
      1.1,
    ),
    sampleProgression(
      'sample-squat',
      'Squat (Barbell)',
      'progressing',
      'add_reps',
      0.9,
    ),
    sampleProgression(
      'sample-pulldown',
      'Lat Pulldown',
      'holding',
      'hold',
      0.2,
    ),
    sampleProgression(
      'sample-rdl',
      'Romanian Deadlift',
      'holding',
      'hold',
      -0.3,
    ),
  ];
  const sampleProgressionFields = (id: string) => {
    const state = progressionStates.find(
      (progression) => progression.exerciseTemplateId === id,
    ) as ProgressionState;
    return {
      exerciseTemplateId: id,
      slotId: null,
      slotName: null,
      progressionStatus: state.status,
      progressionRecommendation: state.recommendation,
      progressionRationale: state.rationale,
      modalLoadKg: state.modalLoadKg,
      targetRepRange: state.targetRepRange,
      repsAtModalLoad: state.repsAtModalLoad,
      lastSetRpe: state.lastSetRpe,
    };
  };
  return {
    analysis: createAnalysisMetadata([], [], new Date()),
    connected: false,
    sourceLabel: 'Sample workspace',
    syncMessage: message,
    athleteName: 'Athlete',
    lastWorkout: 'Upper A · Sep 8',
    stats: {
      sessions30d: 14,
      workingSets7d: 46,
      hours30d: 13.8,
      activeWeeks: 7,
      totalVolume30dKg: 88240,
      avgSessionMinutes: 59,
      consistencyPercent: 88,
      adherencePct: 88,
      plannedSessionsPerWeek: 4,
      volumeChangePercent: 8.4,
    },
    muscles,
    muscleWindows: {
      '7': muscles,
      '14': scaleMuscles(1.9, 1.9),
      '30': scaleMuscles(4, 4),
    },
    unmappedExercises: [],
    trend: { exercise: 'Bench Press (Barbell)', change: 4.8, points },
    strengthTrends: [
      { exercise: 'Bench Press (Barbell)', change: 4.8, bestKg: 96.1, points },
      {
        exercise: 'Squat (Barbell)',
        change: 3.2,
        bestKg: 138.4,
        points: points.map((point) => ({
          ...point,
          value: point.value * 1.42,
        })),
      },
      {
        exercise: 'Lat Pulldown',
        change: 1.7,
        bestKg: 74.2,
        points: points.map((point) => ({
          ...point,
          value: point.value * 0.76,
        })),
      },
    ],
    workloadWeeks: [
      'Jul 20',
      'Jul 27',
      'Aug 3',
      'Aug 10',
      'Aug 17',
      'Aug 24',
      'Aug 31',
      'Sep 7',
    ].map((label, index) => ({
      label,
      sets: [38, 44, 41, 48, 45, 42, 50, 46][index],
      volumeKg: [18000, 21000, 19800, 23600, 22100, 20700, 24100, 22900][index],
      sessions: [3, 4, 3, 4, 4, 3, 4, 4][index],
    })),
    adherenceWeeks: [
      'Jul 20',
      'Jul 27',
      'Aug 3',
      'Aug 10',
      'Aug 17',
      'Aug 24',
      'Aug 31',
      'Sep 7',
    ].map((label, index) => ({
      weekStart: label,
      label,
      plannedSessions: 4,
      actualSessions: [3, 4, 3, 4, 4, 3, 4, 4][index],
      adherencePct: Math.min(100, Math.round(([3, 4, 3, 4, 4, 3, 4, 4][index] / 4) * 100)),
    })),
    balance: demoBalance,
    records: [
      {
        exercise: 'Bench Press (Barbell)',
        date: 'Sep 8',
        valueKg: 96.1,
        reps: 6,
        weightKg: 80,
        kind: 'e1rm',
        previousValue: 94.5,
        previousDate: 'Aug 31',
        scope: 'template',
      },
      {
        exercise: 'Squat (Barbell)',
        date: 'Sep 6',
        valueKg: 138.4,
        reps: 5,
        weightKg: 118,
        kind: 'e1rm',
        previousValue: 136.8,
        previousDate: 'Aug 29',
        scope: 'template',
      },
    ],
    exerciseStats: [
      {
        ...sampleProgressionFields('sample-bench'),
        exercise: 'Bench Press (Barbell)',
        muscle: 'Chest',
        sessions: 14,
        workingSets: 48,
        volumeKg: 28200,
        bestE1rmKg: 96.1,
        change: 4.8,
      },
      {
        ...sampleProgressionFields('sample-squat'),
        exercise: 'Squat (Barbell)',
        muscle: 'Quadriceps',
        sessions: 11,
        workingSets: 42,
        volumeKg: 39800,
        bestE1rmKg: 138.4,
        change: 3.2,
      },
      {
        ...sampleProgressionFields('sample-pulldown'),
        exercise: 'Lat Pulldown',
        muscle: 'Lats',
        sessions: 10,
        workingSets: 36,
        volumeKg: 18400,
        bestE1rmKg: 74.2,
        change: 1.7,
      },
      {
        ...sampleProgressionFields('sample-rdl'),
        exercise: 'Romanian Deadlift',
        muscle: 'Hamstrings',
        sessions: 9,
        workingSets: 31,
        volumeKg: 27600,
        bestE1rmKg: 121.5,
        change: -0.8,
      },
    ],
    progressionStates,
    exerciseSlots: [],
    slotSuggestions: [],
    recentWorkouts: [
      {
        title: 'Upper A',
        date: 'Sep 8',
        duration: '54 min',
        exercises: 6,
        workingSets: 18,
        volumeKg: 7420,
      },
      {
        title: 'Lower B',
        date: 'Sep 6',
        duration: '62 min',
        exercises: 7,
        workingSets: 20,
        volumeKg: 9860,
      },
      {
        title: 'Pull',
        date: 'Sep 4',
        duration: '48 min',
        exercises: 6,
        workingSets: 17,
        volumeKg: 6250,
      },
      {
        title: 'Upper B',
        date: 'Sep 1',
        duration: '58 min',
        exercises: 7,
        workingSets: 21,
        volumeKg: 8110,
      },
    ],
    calendarWorkouts,
    exerciseOptions,
    weeklyReview: {
      label: 'Sep 7–Sep 13',
      wins: [
        'Four sessions completed with 46 direct working sets.',
        'Two estimated strength PRs appeared in the last 30 days.',
        'Load-volume is up 8.4% week over week.',
      ],
      watch: [
        'Shoulder volume fell slightly versus last week.',
        'Lower-body sessions are running longer than average.',
      ],
      nextSteps: [
        'Keep bench load stable and earn one clean rep.',
        'Place the lower-body compound first next session.',
      ],
    },
    insights: {
      plateau:
        'Bench press is up 4.8% across six comparable sessions; hold load and look for one more clean rep.',
      return:
        'After a three-week break, reduce set count, keep several reps in reserve, and rebuild gradually.',
      progress:
        'Bench press is the clearest upward signal. Lateral raise is the next simple rep-progression opportunity.',
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
    sourceLabel: 'Hevy unavailable',
    syncMessage: message,
    athleteName: 'Athlete',
    lastWorkout: 'Unavailable — sync Hevy to load verified history',
    stats: {
      sessions30d: 0,
      workingSets7d: 0,
      hours30d: 0,
      activeWeeks: 0,
      totalVolume30dKg: 0,
      avgSessionMinutes: 0,
      consistencyPercent: 0,
      adherencePct: 0,
      plannedSessionsPerWeek: 4,
      volumeChangePercent: 0,
    },
    muscles: [],
    muscleWindows: { '7': [], '14': [], '30': [] },
    unmappedExercises: [],
    trend: { exercise: 'No verified lift data', change: 0, points: [] },
    strengthTrends: [],
    workloadWeeks: emptyWeeks,
    adherenceWeeks: [],
    balance: [],
    records: [],
    exerciseStats: [],
    progressionStates: [],
    exerciseSlots: [],
    slotSuggestions: [],
    recentWorkouts: [],
    calendarWorkouts: [],
    exerciseOptions: [],
    weeklyReview: {
      label: 'No verified data',
      wins: [],
      watch: [
        'Hevy history is unavailable, so no workout-specific coaching is safe yet.',
      ],
      nextSteps: ['Retry the Hevy sync before asking for progress feedback.'],
    },
    insights: {
      plateau: 'No verified Hevy data is available to assess a plateau.',
      return: 'No verified Hevy data is available to assess a return plan.',
      progress: 'No verified Hevy data is available to assess progress.',
    },
  };
}

export async function getDashboardData(
  userId = 'local-owner',
): Promise<DashboardData> {
  const apiKey = process.env.HEVY_API_KEY;
  try {
    const { getHevySyncState, listStoredHevyWorkouts, listStoredTemplates } =
      await import('./hevy-repo');
    const { getProfile } = await import('./storage');
    const { listMuscleOverrides } = await import('./muscle-repo');
    const { listExerciseSlots } = await import('./slot-repo');
    const [workouts, templateRows, syncState, overrides, slots, profile] =
      await Promise.all([
        listStoredHevyWorkouts(userId, { limit: 5_000 }),
        listStoredTemplates(userId),
        getHevySyncState(userId),
        listMuscleOverrides(userId),
        listExerciseSlots(userId),
        getProfile(userId),
      ]);
    if (workouts.length) {
      const dashboard = analyzeWorkoutHistory(
        workouts,
        templateRows.map(deserializeHevyTemplate),
        'Athlete',
        new Date(),
        overrides,
        slots,
        profile.daysPerWeek,
      );
      try {
        const { saveProgressionStates } = await import('./progression-repo');
        await saveProgressionStates(
          userId,
          dashboard.progressionStates,
          dashboard.analysis.version,
          dashboard.analysis.generatedAt,
        );
      } catch (error) {
        console.error('Progression state cache could not be refreshed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
      }
      try {
        const { savePersonalRecords } = await import('./records-repo');
        await savePersonalRecords(
          userId,
          detectRecords(
            workouts,
            templateRows.map(deserializeHevyTemplate),
            overrides,
            slots,
          ),
        );
      } catch (error) {
        console.error('Personal record cache could not be refreshed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
      }
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
    const reason =
      error instanceof Error ? error.message : 'Unknown storage error';
    return unavailableData(`Hevy connection needs attention: ${reason}`);
  }
}
