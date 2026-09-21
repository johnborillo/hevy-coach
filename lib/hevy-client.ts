import type { ExerciseTemplate, HevyWorkout } from './hevy-types';

const API_ROOT = 'https://api.hevyapp.com/v1';

export type HevyPage<T> = {
  page: number;
  page_count: number;
} & T;

export type HevyWorkoutEvent =
  | { type: 'updated'; workout: HevyWorkout }
  | { type: 'deleted'; id: string; deleted_at?: string };

export type HevyApi = {
  workouts(page: number): Promise<HevyPage<{ workouts: HevyWorkout[] }>>;
  workoutEvents(
    since: string,
    page: number,
  ): Promise<HevyPage<{ events: HevyWorkoutEvent[] }>>;
  templates(
    page: number,
  ): Promise<HevyPage<{ exercise_templates: ExerciseTemplate[] }>>;
};

export function createHevyClient(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): HevyApi {
  async function get<T>(path: string) {
    const response = await fetcher(`${API_ROOT}${path}`, {
      headers: { 'api-key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Hevy returned ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    workouts(page) {
      return get<HevyPage<{ workouts: HevyWorkout[] }>>(
        `/workouts?page=${page}&pageSize=10`,
      );
    },
    workoutEvents(since, page) {
      const query = new URLSearchParams({
        since,
        page: String(page),
        pageSize: '10',
      });
      return get<HevyPage<{ events: HevyWorkoutEvent[] }>>(
        `/workouts/events?${query}`,
      );
    },
    templates(page) {
      return get<HevyPage<{ exercise_templates: ExerciseTemplate[] }>>(
        `/exercise_templates?page=${page}&pageSize=100`,
      );
    },
  };
}
