import { asksAboutRecentTraining } from './coach-clock';
import type { HevySyncResult } from './hevy-sync';

// Chat normally reads only the local store. When the athlete asks about
// today, yesterday or their latest session, a stale store would make the
// coach describe an older workout, so run one bounded delta sync first.
// syncHevy itself skips the network call when the last sync is under
// 10 minutes old, so repeated questions stay fast.
export const FRESHEN_TIMEOUT_MS = 6_000;

export type FreshenOutcome =
  | 'not_needed'
  | 'unavailable'
  | 'current'
  | 'synced'
  | 'timed_out'
  | 'failed';

type FreshenDeps = {
  apiKey?: string;
  sync?: (userId: string, apiKey: string) => Promise<HevySyncResult>;
  refresh?: (userId: string) => Promise<unknown>;
  timeoutMs?: number;
};

export async function freshenForRecentQuestion(
  userId: string,
  question: string,
  deps: FreshenDeps = {},
): Promise<FreshenOutcome> {
  if (!asksAboutRecentTraining(question)) return 'not_needed';
  const apiKey = deps.apiKey ?? process.env.HEVY_API_KEY;
  if (!apiKey) return 'unavailable';
  const sync =
    deps.sync ??
    (async (id: string, key: string) =>
      (await import('./hevy-sync')).syncHevy(id, key, {
        maxFullSyncPages: 1,
      }));
  const refresh =
    deps.refresh ??
    (async (id: string) =>
      (await import('./derive')).refreshDerivedAnalysis(id, 'sync'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), deps.timeoutMs ?? FRESHEN_TIMEOUT_MS);
  });
  const work = (async (): Promise<FreshenOutcome> => {
    const result = await sync(userId, apiKey);
    if (result.mode === 'none') return 'current';
    await refresh(userId);
    return 'synced';
  })().catch((error: unknown) => {
    console.warn('Hevy freshness sync before a coach answer failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return 'failed' as const;
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
