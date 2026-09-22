import { analyzeWorkoutHistory, type DashboardData } from './hevy';
import { deserializeHevyTemplate } from './hevy-store';
import { listStoredHevyWorkouts, listStoredTemplates } from './hevy-repo';
import { composeWeeklyReview, type FindingContext } from './findings';
import { listTrainingBlocks, type TrainingBlock } from './training-block-repo';
import { detectRecords, type PersonalRecord } from './records';
import { getProfile } from './storage';
import { flagNotes, painSuppressedExerciseTemplateIds } from './notes';
import {
  getWeeklyReview,
  listWeeklyReviews,
  saveWeeklyReview,
} from './review-repo';
import { localDayKey, localMondayStart, shiftLocalDays } from './time';

export function mondayStart(value: Date, timeZone = 'UTC') {
  return localMondayStart(value, timeZone);
}

export function closedWeekStart(now = new Date(), timeZone = 'UTC') {
  return shiftLocalDays(mondayStart(now, timeZone), -7, timeZone);
}

function inWindow(value: string, start: number, end: number) {
  const time = new Date(value).getTime();
  return time >= start && time < end;
}

function blockForDate(blocks: TrainingBlock[], date: number) {
  return (
    blocks.find((block) => {
      const start = new Date(block.startsAt).getTime();
      const end = block.endsAt
        ? new Date(block.endsAt).getTime()
        : Number.POSITIVE_INFINITY;
      return start <= date && date < end;
    }) ?? null
  );
}

function weekTotals(
  dashboard: DashboardData,
  start: number,
  end: number,
  timeZone: string,
) {
  const startKey = localDayKey(new Date(start), timeZone);
  const endKey = localDayKey(new Date(end - 1), timeZone);
  const workouts = dashboard.calendarWorkouts.filter(
    (workout) => workout.date >= startKey && workout.date <= endKey,
  );
  return {
    sessions: new Set(workouts.map((workout) => workout.id)).size,
    directSets: Math.round(
      workouts.reduce((sum, workout) => sum + workout.workingSets, 0),
    ),
    volumeKg: workouts.reduce((sum, workout) => sum + workout.volumeKg, 0),
  };
}

function reviewContext(
  dashboard: DashboardData,
  weekStart: Date,
  profile: Awaited<ReturnType<typeof getProfile>>,
  records: PersonalRecord[],
  citations: string[],
  activeBlock: TrainingBlock | null,
  sessionsInPriorWeek: number,
  volumeChangePercent: number,
  noteFlags: FindingContext['noteFlags'],
  painSuppressedExerciseTemplateIds: string[],
  painSuppressedSlotIds: string[],
): FindingContext {
  const start = weekStart.getTime();
  const end = shiftLocalDays(weekStart, 7, profile.timezone).getTime();
  const totals = weekTotals(dashboard, start, end, profile.timezone);
  const planned = profile.daysPerWeek;
  return {
    weekStart: weekStart.toISOString(),
    weekEnd: new Date(end).toISOString(),
    summary: {
      sessions: totals.sessions,
      planned,
      directSets: totals.directSets,
      prs: records.filter((record) => inWindow(record.performedAt, start, end))
        .length,
    },
    progressionStates: dashboard.progressionStates,
    records,
    muscles: dashboard.muscles.map((muscle) => ({
      key: muscle.key,
      name: muscle.name,
      sets: muscle.sets,
      fourWeekAvgDirect: muscle.fourWeekAvgDirect,
      bandLabel: muscle.bandLabel,
    })),
    balance: dashboard.balance,
    adherencePct: planned
      ? Math.min(100, Math.round((totals.sessions / planned) * 100))
      : 0,
    plannedSessionsPerWeek: planned,
    sessionsInPriorWeek,
    volumeChangePercent,
    phase: profile.phase,
    activeBlockKind: activeBlock?.kind ?? null,
    citations,
    unmappedExercises: dashboard.unmappedExercises,
    noteFlags,
    painSuppressedExerciseTemplateIds,
    painSuppressedSlotIds,
  };
}

export async function generateWeeklyReview(
  userId: string,
  weekStart: string,
  options: { force?: boolean } = {},
) {
  const existing = options.force
    ? null
    : await getWeeklyReview(userId, weekStart);
  if (existing) return existing;
  const start = new Date(weekStart);
  const startMs = start.getTime();
  if (!Number.isFinite(startMs)) throw new Error('Invalid review week.');
  const profile = await getProfile(userId);
  const endMs = shiftLocalDays(start, 7, profile.timezone).getTime();
  const [workouts, templateRows, blocks, overrides, slots] = await Promise.all([
    listStoredHevyWorkouts(userId, { limit: 5_000 }),
    listStoredTemplates(userId),
    listTrainingBlocks(userId),
    (async () => (await import('./muscle-repo')).listMuscleOverrides(userId))(),
    (async () => (await import('./slot-repo')).listExerciseSlots(userId))(),
  ]);
  const templates = templateRows.map(deserializeHevyTemplate);
  const activeBlock = blockForDate(blocks, startMs + (endMs - startMs) / 2);
  const records = detectRecords(workouts, templates, overrides, slots);
  const dashboard = analyzeWorkoutHistory(
    workouts,
    templates,
    profile.displayName,
    new Date(endMs - 1),
    overrides,
    slots,
    profile.daysPerWeek,
    profile.phase,
    activeBlock?.kind ?? null,
    profile.timezone,
  );
  const citations = workouts
    .filter((workout) => inWindow(workout.start_time, startMs, endMs))
    .map((workout) => workout.id);
  const noteFlags = workouts
    .filter((workout) => inWindow(workout.start_time, startMs, endMs))
    .flatMap((workout) =>
      flagNotes(workout, start.toISOString(), profile.timezone),
    );
  const painSuppressed = painSuppressedExerciseTemplateIds(workouts);
  const painSuppressedSlots = dashboard.exerciseSlots
    .filter((slot) =>
      slot.templateIds.some((id) => painSuppressed.includes(id)),
    )
    .map((slot) => slot.id);
  const priorStart = shiftLocalDays(start, -7, profile.timezone);
  const priorTotals = weekTotals(
    dashboard,
    priorStart.getTime(),
    startMs,
    profile.timezone,
  );
  const currentTotals = weekTotals(dashboard, startMs, endMs, profile.timezone);
  const volumeChangePercent = priorTotals.volumeKg
    ? Math.round(
        ((currentTotals.volumeKg - priorTotals.volumeKg) /
          priorTotals.volumeKg) *
          100,
      )
    : 0;
  const previous = await getWeeklyReview(userId, priorStart.toISOString());
  const review = composeWeeklyReview(
    reviewContext(
      dashboard,
      start,
      profile,
      records,
      citations,
      activeBlock,
      priorTotals.sessions,
      volumeChangePercent,
      noteFlags,
      painSuppressed,
      painSuppressedSlots,
    ),
    previous,
  );
  return saveWeeklyReview(userId, review);
}

export async function ensurePreviousWeekReview(
  userId: string,
  now = new Date(),
) {
  const profile = await getProfile(userId);
  const week = closedWeekStart(now, profile.timezone);
  return generateWeeklyReview(userId, week.toISOString());
}

export async function listReviewHistory(userId: string, limit = 12) {
  return listWeeklyReviews(userId, limit);
}
