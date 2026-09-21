import { describe, expect, it, vi } from 'vitest';
import type { HevyApi } from '../lib/hevy-client';
import type { HevySyncRepository, HevySyncResult } from '../lib/hevy-sync';
import { syncHevy } from '../lib/hevy-sync';
import type { HevySyncState } from '../lib/hevy-repo';
import type { HevyWorkout } from '../lib/hevy-types';

function workout(id: string, updatedAt: string): HevyWorkout {
  return {
    id,
    title: `Workout ${id}`,
    start_time: updatedAt,
    end_time: updatedAt,
    updated_at: updatedAt,
    exercises: [],
  };
}

function createMemoryRepository(initialState: HevySyncState | null = null) {
  let state = initialState ? { ...initialState } : null;
  const workouts = new Map<string, HevyWorkout>();
  const templates = new Set<string>();
  const repo: HevySyncRepository = {
    async countWorkouts() {
      return workouts.size;
    },
    async getState() {
      return state ? { ...state } : null;
    },
    async saveState(next) {
      state = { ...next };
      return { ...next };
    },
    async replaceWorkout(_userId, value) {
      workouts.set(value.id, value);
    },
    async markWorkoutDeleted(_userId, workoutId) {
      workouts.delete(workoutId);
    },
    async upsertTemplates(_userId, values) {
      values.forEach((value) => templates.add(value.id));
    },
  };
  return {
    repo,
    workouts,
    templates,
    state: () => state,
  };
}

describe('Hevy synchronization', () => {
  it('checkpoints and resumes a bounded full-history import', async () => {
    const memory = createMemoryRepository();
    const templateRequest = vi.fn(async () => ({
      page: 1,
      page_count: 1,
      exercise_templates: [{ id: 'bench', title: 'Bench Press' }],
    }));
    const client: HevyApi = {
      workouts: vi.fn(async (page: number) => ({
        page,
        page_count: 2,
        workouts: [workout(String(page), `2026-09-0${page}T10:00:00.000Z`)],
      })),
      workoutEvents: vi.fn(),
      templates: templateRequest,
    };

    const first = await syncHevy('athlete', 'key', {
      client,
      repository: memory.repo,
      maxFullSyncPages: 1,
      now: new Date('2026-09-21T12:00:00.000Z'),
    });
    expect(first).toMatchObject<Partial<HevySyncResult>>({
      status: 'syncing',
      mode: 'full',
      workoutCount: 1,
      nextPage: 2,
      pageCount: 2,
    });

    const second = await syncHevy('athlete', 'key', {
      client,
      repository: memory.repo,
      maxFullSyncPages: 1,
      now: new Date('2026-09-21T12:01:00.000Z'),
    });
    expect(second).toMatchObject({
      status: 'current',
      mode: 'full',
      workoutCount: 2,
      nextPage: null,
    });
    expect(memory.state()).toMatchObject({
      fullSyncNextPage: 1,
      fullSyncPageCount: 2,
      fullSyncCompletedAt: '2026-09-21T12:01:00.000Z',
      lastEventSince: '2026-09-21T12:00:00.000Z',
    });
    expect(templateRequest).toHaveBeenCalledTimes(1);
  });

  it('applies updated and deleted events idempotently', async () => {
    const memory = createMemoryRepository({
      userId: 'athlete',
      lastEventSince: '2026-09-20T00:00:00.000Z',
      fullSyncNextPage: 1,
      fullSyncPageCount: 1,
      fullSyncCompletedAt: '2026-09-20T00:00:00.000Z',
      templatesSyncedAt: '2026-09-20T13:00:00.000Z',
      lastSyncAt: '2026-09-20T12:00:00.000Z',
      lastError: null,
    });
    await memory.repo.replaceWorkout(
      'athlete',
      workout('deleted', '2026-09-19T12:00:00.000Z'),
    );
    const client: HevyApi = {
      workouts: vi.fn(),
      templates: vi.fn(),
      workoutEvents: vi.fn(async () => ({
        page: 1,
        page_count: 1,
        events: [
          {
            type: 'updated' as const,
            workout: workout('updated', '2026-09-21T09:00:00.000Z'),
          },
          {
            type: 'deleted' as const,
            id: 'deleted',
            deleted_at: '2026-09-21T08:00:00.000Z',
          },
        ],
      })),
    };

    const result = await syncHevy('athlete', 'key', {
      client,
      repository: memory.repo,
      force: true,
      now: new Date('2026-09-21T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'current',
      mode: 'delta',
      workoutCount: 1,
    });
    expect([...memory.workouts.keys()]).toEqual(['updated']);
    expect(memory.state()).toMatchObject({
      lastEventSince: '2026-09-21T09:00:00.000Z',
      lastSyncAt: '2026-09-21T12:00:00.000Z',
      lastError: null,
    });
  });

  it('skips the network while the cache is fresh', async () => {
    const memory = createMemoryRepository({
      userId: 'athlete',
      lastEventSince: '2026-09-21T11:55:00.000Z',
      fullSyncNextPage: 1,
      fullSyncPageCount: 1,
      fullSyncCompletedAt: '2026-09-21T11:55:00.000Z',
      templatesSyncedAt: '2026-09-21T11:55:00.000Z',
      lastSyncAt: '2026-09-21T11:55:00.000Z',
      lastError: null,
    });
    const eventRequest = vi.fn();
    const client: HevyApi = {
      workouts: vi.fn(),
      templates: vi.fn(),
      workoutEvents: eventRequest,
    };

    const result = await syncHevy('athlete', 'key', {
      client,
      repository: memory.repo,
      now: new Date('2026-09-21T12:00:00.000Z'),
    });
    expect(result.mode).toBe('none');
    expect(eventRequest).not.toHaveBeenCalled();
  });
});
