import { createHevyClient, type HevyApi } from './hevy-client';
import type { HevySyncState } from './hevy-repo';
import type { ExerciseTemplate, HevyWorkout } from './hevy-types';

const TEMPLATE_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const SYNC_FRESHNESS_MS = 10 * 60 * 1_000;

export type HevySyncResult = {
  status: 'syncing' | 'current';
  mode: 'full' | 'delta' | 'none';
  workoutCount: number;
  nextPage: number | null;
  pageCount: number | null;
  lastSyncAt: string | null;
};

export type HevySyncRepository = {
  countWorkouts(userId: string): Promise<number>;
  getState(userId: string): Promise<HevySyncState | null>;
  saveState(state: HevySyncState): Promise<HevySyncState>;
  replaceWorkout(
    userId: string,
    workout: HevyWorkout,
    syncedAt?: string,
  ): Promise<unknown>;
  markWorkoutDeleted(
    userId: string,
    workoutId: string,
    syncedAt?: string,
  ): Promise<unknown>;
  upsertTemplates(
    userId: string,
    templates: ExerciseTemplate[],
    syncedAt?: string,
  ): Promise<unknown>;
};

async function defaultRepository(): Promise<HevySyncRepository> {
  const repo = await import('./hevy-repo');
  return {
    countWorkouts: repo.countStoredWorkouts,
    getState: repo.getHevySyncState,
    saveState: repo.saveHevySyncState,
    replaceWorkout: repo.replaceStoredWorkout,
    markWorkoutDeleted: repo.markStoredWorkoutDeleted,
    upsertTemplates: repo.upsertStoredTemplates,
  };
}

function initialState(userId: string, startedAt: string): HevySyncState {
  return {
    userId,
    lastEventSince: startedAt,
    fullSyncNextPage: 1,
    fullSyncPageCount: null,
    fullSyncCompletedAt: null,
    templatesSyncedAt: null,
    lastSyncAt: null,
    lastError: null,
  };
}

function isOlderThan(value: string | null, ageMs: number, nowMs: number) {
  return !value || nowMs - new Date(value).getTime() >= ageMs;
}

async function syncTemplates(
  userId: string,
  client: HevyApi,
  repo: HevySyncRepository,
  syncedAt: string,
) {
  let page = 1;
  let pageCount = 1;
  do {
    const response = await client.templates(page);
    pageCount = response.page_count;
    await repo.upsertTemplates(userId, response.exercise_templates, syncedAt);
    page += 1;
  } while (page <= pageCount);
}

async function runFullSyncStep(
  userId: string,
  client: HevyApi,
  repo: HevySyncRepository,
  state: HevySyncState,
  now: Date,
  maxPages: number,
): Promise<HevySyncResult> {
  const syncedAt = now.toISOString();
  let nextState = { ...state, lastError: null };

  if (
    isOlderThan(state.templatesSyncedAt, TEMPLATE_FRESHNESS_MS, now.getTime())
  ) {
    await syncTemplates(userId, client, repo, syncedAt);
    nextState.templatesSyncedAt = syncedAt;
    await repo.saveState(nextState);
  }

  let processedPages = 0;
  while (processedPages < maxPages && !nextState.fullSyncCompletedAt) {
    const page = nextState.fullSyncNextPage;
    const response = await client.workouts(page);
    for (const workout of response.workouts) {
      await repo.replaceWorkout(userId, workout, syncedAt);
    }

    const completed = response.page_count === 0 || page >= response.page_count;
    nextState = {
      ...nextState,
      fullSyncNextPage: completed ? 1 : page + 1,
      fullSyncPageCount: response.page_count,
      fullSyncCompletedAt: completed ? syncedAt : null,
      lastSyncAt: completed ? syncedAt : nextState.lastSyncAt,
      lastError: null,
    };
    await repo.saveState(nextState);
    processedPages += 1;
  }

  return {
    status: nextState.fullSyncCompletedAt ? 'current' : 'syncing',
    mode: 'full',
    workoutCount: await repo.countWorkouts(userId),
    nextPage: nextState.fullSyncCompletedAt ? null : nextState.fullSyncNextPage,
    pageCount: nextState.fullSyncPageCount,
    lastSyncAt: nextState.lastSyncAt,
  };
}

async function runDeltaSync(
  userId: string,
  client: HevyApi,
  repo: HevySyncRepository,
  state: HevySyncState,
  now: Date,
) {
  const syncedAt = now.toISOString();
  const since =
    state.lastEventSince ?? state.fullSyncCompletedAt ?? '1970-01-01T00:00:00Z';
  let newestEventAt = since;
  let page = 1;
  let pageCount = 1;

  do {
    const response = await client.workoutEvents(since, page);
    pageCount = response.page_count;
    for (const event of response.events) {
      if (event.type === 'updated') {
        await repo.replaceWorkout(userId, event.workout, syncedAt);
        if (
          event.workout.updated_at &&
          event.workout.updated_at > newestEventAt
        ) {
          newestEventAt = event.workout.updated_at;
        }
      } else {
        await repo.markWorkoutDeleted(userId, event.id, syncedAt);
        if (event.deleted_at && event.deleted_at > newestEventAt) {
          newestEventAt = event.deleted_at;
        }
      }
    }
    page += 1;
  } while (page <= pageCount);

  let templatesSyncedAt = state.templatesSyncedAt;
  if (isOlderThan(templatesSyncedAt, TEMPLATE_FRESHNESS_MS, now.getTime())) {
    await syncTemplates(userId, client, repo, syncedAt);
    templatesSyncedAt = syncedAt;
  }

  const nextState = {
    ...state,
    lastEventSince: newestEventAt,
    templatesSyncedAt,
    lastSyncAt: syncedAt,
    lastError: null,
  };
  await repo.saveState(nextState);
  return {
    status: 'current',
    mode: 'delta',
    workoutCount: await repo.countWorkouts(userId),
    nextPage: null,
    pageCount: null,
    lastSyncAt: syncedAt,
  } satisfies HevySyncResult;
}

export async function syncHevy(
  userId: string,
  apiKey: string,
  options: {
    force?: boolean;
    maxFullSyncPages?: number;
    now?: Date;
    client?: HevyApi;
    repository?: HevySyncRepository;
  } = {},
): Promise<HevySyncResult> {
  const now = options.now ?? new Date();
  const repo = options.repository ?? (await defaultRepository());
  const client = options.client ?? createHevyClient(apiKey);
  let state = await repo.getState(userId);
  if (!state) {
    state = initialState(userId, now.toISOString());
    await repo.saveState(state);
  }

  try {
    if (!state.fullSyncCompletedAt) {
      return await runFullSyncStep(
        userId,
        client,
        repo,
        state,
        now,
        Math.min(Math.max(options.maxFullSyncPages ?? 3, 1), 10),
      );
    }

    if (
      options.force ||
      isOlderThan(state.lastSyncAt, SYNC_FRESHNESS_MS, now.getTime())
    ) {
      return await runDeltaSync(userId, client, repo, state, now);
    }

    return {
      status: 'current',
      mode: 'none',
      workoutCount: await repo.countWorkouts(userId),
      nextPage: null,
      pageCount: null,
      lastSyncAt: state.lastSyncAt,
    };
  } catch (error) {
    const latestState = (await repo.getState(userId)) ?? state;
    await repo.saveState({
      ...latestState,
      lastError: error instanceof Error ? error.message : 'Unknown sync error',
    });
    throw error;
  }
}
