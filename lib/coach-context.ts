import type { DashboardData } from './hevy';
import type { AthleteProfile, ChatMessage } from './storage';
import { buildAthleteContext } from './context';
import type { NoteSearchResult } from './notes-repo';

export type CoachContextOptions = {
  additionalDates?: string[];
  noteResults?: NoteSearchResult[];
};

export type CoachContext = {
  text: string;
  workoutIds: string[];
  estimatedTokens: number;
};

function compactWorkout(
  workout: DashboardData['calendarWorkouts'][number],
  profile: AthleteProfile,
) {
  return {
    id: workout.id,
    date: workout.date,
    title: workout.title,
    description: workout.description ?? null,
    time: workout.time,
    durationMinutes: workout.durationMinutes,
    exercises: workout.exercises.map((exercise) => ({
      title: exercise.title,
      muscle: exercise.muscle,
      notes: exercise.notes ?? null,
      sets: exercise.sets.map((set) => ({
        type: set.type,
        load:
          set.weightKg == null
            ? null
            : profile.weightUnit === 'kg'
              ? `${set.weightKg} kg`
              : `${Math.round(set.weightKg * 2.20462 * 10) / 10} lb`,
        reps: set.reps,
        rpe: set.rpe,
      })),
    })),
  };
}

function displayWeight(valueKg: number | null, profile: AthleteProfile) {
  if (valueKg == null || !Number.isFinite(valueKg)) return null;
  const value = profile.weightUnit === 'kg' ? valueKg : valueKg * 2.2046226218;
  return `${Math.round(value * 10) / 10} ${profile.weightUnit}`;
}

function normalizedWords(value: string) {
  const stopWords = new Set([
    'and',
    'bar',
    'cable',
    'dumbbell',
    'machine',
    'the',
    'with',
  ]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

function mentionsExercise(question: string, title: string) {
  const questionWords = new Set(normalizedWords(question));
  const titleWords = normalizedWords(title);
  if (!titleWords.length) return false;
  return titleWords.some((word) => questionWords.has(word));
}

function lastQuestion(history: ChatMessage[]) {
  return [...history].reverse().find((message) => message.role === 'user')?.content ?? '';
}

function datesInQuestion(question: string) {
  return [...question.matchAll(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g)].map(
    (match) => match[0].replaceAll('/', '-'),
  );
}

export function buildCoachContext(
  profile: AthleteProfile,
  dashboard: DashboardData,
  history: ChatMessage[] = [],
  options: CoachContextOptions = {},
): CoachContext {
  const question = lastQuestion(history).toLowerCase();
  const athleteContext = buildAthleteContext(
    profile,
    dashboard.bodyWeightTrend ?? null,
    dashboard.activeTrainingBlock ?? null,
  );
  const requestedDates = [
    ...datesInQuestion(question),
    ...(options.additionalDates ?? []),
  ];
  const referenced = dashboard.calendarWorkouts.filter((workout) =>
    requestedDates.includes(workout.date) ||
    workout.exercises.some((exercise) =>
      mentionsExercise(question, exercise.title),
    ),
  );
  const selected = [
    ...dashboard.calendarWorkouts.slice(0, 3),
    ...referenced,
    ...(options.noteResults ?? []).flatMap((note) =>
      dashboard.calendarWorkouts.filter((workout) => workout.id === note.workoutId),
    ),
  ].filter(
    (workout, index, all) => all.findIndex((item) => item.id === workout.id) === index,
  );
  const review = dashboard.weeklyReviewV2
    ? {
        weekStart: dashboard.weeklyReviewV2.weekStart,
        summary: dashboard.weeklyReviewV2.summary,
        wins: dashboard.weeklyReviewV2.wins.map((item) => ({
          kind: item.kind,
          headline: item.headline,
          evidence: item.evidence,
        })),
        watch: dashboard.weeklyReviewV2.watch.map((item) => ({
          kind: item.kind,
          headline: item.headline,
          evidence: item.evidence,
        })),
        act: dashboard.weeklyReviewV2.act.map((item) => ({
          kind: item.kind,
          headline: item.headline,
          evidence: item.evidence,
          recommendation: item.recommendation,
        })),
        carriedOver: dashboard.weeklyReviewV2.carriedOver.map((item) => ({
          headline: item.finding.headline,
          weeksOpen: item.weeksOpen,
          changed: item.changed,
        })),
      }
    : dashboard.weeklyReview;
  const contextObject = {
    athlete: {
      phase: profile.phase,
      phaseStartedAt: profile.phaseStartedAt || null,
      phaseWeeks: athleteContext.phaseWeeks,
      primaryGoal: profile.primaryGoal,
      experience: profile.experience,
      daysPerWeek: profile.daysPerWeek,
      minutesPerSession: profile.minutesPerSession,
      limitations: profile.limitations,
      preferences: profile.preferences,
      measurementPreferences: {
        weightUnit: profile.weightUnit,
        heightFormat: profile.heightUnit === 'imperial' ? 'feet_and_inches' : 'centimetres',
      },
      height:
        profile.heightCm == null
          ? null
          : profile.heightUnit === 'imperial'
            ? (() => {
                const totalInches = Math.round(profile.heightCm / 2.54);
                return {
                  feet: Math.floor(totalInches / 12),
                  inches: totalInches % 12,
                };
              })()
            : `${Math.round(profile.heightCm * 10) / 10} cm`,
      bodyWeight: displayWeight(profile.weightKg, profile),
      bodyWeightTrend: athleteContext.bodyWeightTrend
        ? {
            average7d: displayWeight(
              athleteContext.bodyWeightTrend.average7d,
              profile,
            ),
            slopePerWeek: displayWeight(
              athleteContext.bodyWeightTrend.slopeKgPerWeek,
              profile,
            ),
            latest: displayWeight(athleteContext.bodyWeightTrend.latest, profile),
          }
        : null,
      activeTrainingBlock: athleteContext.activeBlock
        ? {
            name: athleteContext.activeBlock.name,
            kind: athleteContext.activeBlock.kind,
            startsAt: athleteContext.activeBlock.startsAt,
            endsAt: athleteContext.activeBlock.endsAt,
          }
        : null,
    },
    findings: {
      currentWeek: review,
      previousWeek: dashboard.reviewHistory?.[1] ?? null,
    },
    progression: dashboard.progressionStates
      .filter((state) => {
        const time = new Date(state.lastPerformedAt).getTime();
        return !Number.isFinite(time) || Date.now() - time <= 28 * 86_400_000;
      })
      .map((state) => ({
        title: state.title,
        status: state.status,
        modalLoad: displayWeight(state.modalLoadKg, profile),
        reps: state.repsAtModalLoad.slice(-6),
        rpe: state.lastSetRpe.slice(-6),
        recommendation: state.recommendation,
        rationale: state.rationale,
      })),
    muscleAudit: dashboard.muscles.map((muscle) => ({
      muscle: muscle.name,
      directSets: muscle.sets,
      indirectSets: muscle.indirectSets,
      fourWeekAverage: muscle.fourWeekAvgDirect,
      band: muscle.bandLabel,
    })),
    adherence: dashboard.adherenceWeeks,
    verifiedHevyWorkoutLog: selected.map((workout) => compactWorkout(workout, profile)),
    retrievedNotes: (options.noteResults ?? []).map((note) => ({
      workoutId: note.workoutId,
      workoutDate: note.workoutDate,
      workoutTitle: note.workoutTitle,
      exerciseTemplateId: note.exerciseTemplateId,
      exerciseTitle: note.exerciseTitle,
      note: note.text,
    })),
    workoutCoverage: {
      totalVerified: dashboard.calendarWorkouts.length,
      oldestDate: dashboard.calendarWorkouts.at(-1)?.date ?? null,
      newestDate: dashboard.calendarWorkouts[0]?.date ?? null,
    },
    retrievalNote:
      'Only the verifiedHevyWorkoutLog and retrievedNotes above may support exact workout or note claims. Quote notes verbatim when useful. If another exact workout is needed, request it with [NEED: workout YYYY-MM-DD].',
  };
  const text = JSON.stringify(contextObject);
  return {
    text,
    workoutIds: [
      ...new Set([
        ...selected.map((workout) => workout.id),
        ...(options.noteResults ?? []).map((note) => note.workoutId),
      ]),
    ],
    estimatedTokens: Math.ceil(text.length / 4),
  };
}
