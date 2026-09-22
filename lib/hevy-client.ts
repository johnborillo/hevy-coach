import type { ExerciseTemplate, HevyWorkout } from './hevy-types';

const API_ROOT = 'https://api.hevyapp.com/v1';

export type HevyPage<T> = {
  page: number;
  page_count: number;
} & T;

export type HevyWorkoutEvent =
  | { type: 'updated'; workout: HevyWorkout }
  | { type: 'deleted'; id: string; deleted_at?: string };

export type HevyBodyMeasurement = {
  date: string;
  weight_kg: number | null;
};

export type HevyRoutineSet = {
  type: 'warmup' | 'normal' | 'failure' | 'dropset';
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  custom_metric: number | null;
  rep_range?: { start: number; end: number } | null;
};

export type HevyRoutineExercise = {
  exercise_template_id: string;
  superset_id: number | null;
  rest_seconds: number | null;
  notes: string;
  sets: HevyRoutineSet[];
};

export type HevyRoutinePayload = {
  routine: {
    title: string;
    folder_id?: number | null;
    notes?: string | null;
    source?: 'chatgpt';
    exercises: HevyRoutineExercise[];
  };
};

export type HevyRoutineResponse = {
  routine?: { id?: string; title?: string; [key: string]: unknown };
  id?: string;
  [key: string]: unknown;
};

export type HevyApi = {
  workouts(page: number): Promise<HevyPage<{ workouts: HevyWorkout[] }>>;
  workoutEvents(
    since: string,
    page: number,
  ): Promise<HevyPage<{ events: HevyWorkoutEvent[] }>>;
  templates(
    page: number,
  ): Promise<HevyPage<{ exercise_templates: ExerciseTemplate[] }>>;
  bodyMeasurements?(
    page: number,
  ): Promise<HevyPage<{ body_measurements: HevyBodyMeasurement[] }>>;
  routinesCreate?(payload: HevyRoutinePayload): Promise<HevyRoutineResponse>;
  routinesUpdate?(
    routineId: string,
    payload: Omit<HevyRoutinePayload, 'routine'> & {
      routine: Omit<HevyRoutinePayload['routine'], 'folder_id'>;
    },
  ): Promise<HevyRoutineResponse>;
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

  async function write<T>(path: string, method: 'POST' | 'PUT', body: unknown) {
    const response = await fetcher(`${API_ROOT}${path}`, {
      method,
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Hevy returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
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
    bodyMeasurements(page) {
      return get<HevyPage<{ body_measurements: HevyBodyMeasurement[] }>>(
        `/body_measurements?page=${page}&pageSize=10`,
      );
    },
    routinesCreate(payload) {
      return write<HevyRoutineResponse>('/routines', 'POST', payload);
    },
    routinesUpdate(routineId, payload) {
      return write<HevyRoutineResponse>(
        `/routines/${encodeURIComponent(routineId)}`,
        'PUT',
        payload,
      );
    },
  };
}
