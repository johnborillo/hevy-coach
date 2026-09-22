import { ANALYSIS_ENGINE_VERSION } from './analysis-contracts';
import {
  analysisFingerprint,
  deleteDashboardSnapshot,
  getDashboardSnapshot,
  getDerivationState,
  saveDashboardSnapshot,
  saveDerivationState,
} from './analysis-repo';
import { listBodyWeights, summarizeBodyWeight } from './body-weight-repo';
import {
  getHevySyncState,
  listStoredHevyWorkouts,
  listStoredTemplates,
} from './hevy-repo';
import { deserializeHevyTemplate } from './hevy-store';
import { analyzeWorkoutHistory } from './hevy';
import { listMuscleOverrides } from './muscle-repo';
import { detectRecords } from './records';
import { savePersonalRecords } from './records-repo';
import { saveProgressionStates } from './progression-repo';
import { listExerciseSlots } from './slot-repo';
import { getProfile } from './storage';
import {
  activeTrainingBlock,
  listTrainingBlocks,
} from './training-block-repo';

export type DerivationReason = 'sync' | 'settings' | 'version' | 'manual';

export async function deriveAnalysis(
  userId: string,
  reason: DerivationReason,
) {
  const fingerprint = await analysisFingerprint(userId);
  const [state, snapshot] = await Promise.all([
    getDerivationState(userId),
    getDashboardSnapshot(userId),
  ]);
  if (
    reason !== 'manual' &&
    snapshot &&
    state?.fingerprint === fingerprint &&
    state.version === ANALYSIS_ENGINE_VERSION
  ) {
    return { changed: false, reason, derivedAt: state.derivedAt };
  }

  const [
    workouts,
    templateRows,
    syncState,
    overrides,
    slots,
    profile,
    bodyWeightRows,
    trainingBlocks,
  ] = await Promise.all([
    listStoredHevyWorkouts(userId, { limit: 5_000 }),
    listStoredTemplates(userId),
    getHevySyncState(userId),
    listMuscleOverrides(userId),
    listExerciseSlots(userId),
    getProfile(userId),
    listBodyWeights(userId),
    listTrainingBlocks(userId),
  ]);
  const derivedAt = new Date().toISOString();

  if (!workouts.length) {
    await deleteDashboardSnapshot(userId);
    await saveDerivationState(userId, {
      fingerprint,
      derivedAt,
      version: ANALYSIS_ENGINE_VERSION,
    });
    return { changed: true, reason, derivedAt, workoutCount: 0 };
  }

  const templates = templateRows.map(deserializeHevyTemplate);
  const dashboard = analyzeWorkoutHistory(
    workouts,
    templates,
    profile.displayName,
    new Date(),
    overrides,
    slots,
    profile.daysPerWeek,
    profile.phase,
    activeTrainingBlock(trainingBlocks)?.kind ?? null,
    profile.timezone,
  );

  await Promise.all([
    saveProgressionStates(
      userId,
      dashboard.progressionStates,
      dashboard.analysis.version,
      dashboard.analysis.generatedAt,
    ),
    savePersonalRecords(
      userId,
      detectRecords(workouts, templates, overrides, slots),
    ),
  ]);

  let weeklyReviewV2: import('./findings').WeeklyReview | null = null;
  let reviewHistory: import('./findings').WeeklyReview[] = [];
  try {
    const { ensurePreviousWeekReview, listReviewHistory } =
      await import('./review');
    weeklyReviewV2 = await ensurePreviousWeekReview(userId);
    reviewHistory = await listReviewHistory(userId);
  } catch (error) {
    console.error('Weekly review could not be refreshed during derivation', {
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
  await saveDashboardSnapshot(
    userId,
    {
      ...dashboard,
      bodyWeightTrend: summarizeBodyWeight(bodyWeightRows),
      activeTrainingBlock: activeTrainingBlock(trainingBlocks),
      weeklyReviewV2,
      reviewHistory,
      sourceLabel: 'Synchronized Hevy history',
      syncMessage: `Analyzed ${workouts.length} workouts${progress}`,
    },
    derivedAt,
  );
  await saveDerivationState(userId, {
    fingerprint,
    derivedAt,
    version: ANALYSIS_ENGINE_VERSION,
  });

  return { changed: true, reason, derivedAt, workoutCount: workouts.length };
}

export async function refreshDerivedAnalysis(
  userId: string,
  reason: DerivationReason,
) {
  try {
    return await deriveAnalysis(userId, reason);
  } catch (error) {
    console.error('Cached analysis could not be refreshed', {
      reason,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}
