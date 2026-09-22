import { createHevyClient, type HevyRoutinePayload } from './hevy-client';
import type { TrainingProgram } from './storage';

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

function secret() {
  return process.env.HEVY_ROUTINE_CONFIRM_SECRET || process.env.HEVY_API_KEY || '';
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(message: string) {
  const keyMaterial = secret();
  if (!keyMaterial) throw new Error('Routine write confirmation is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  );
}

async function sha256(value: string) {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function assertDay(program: TrainingProgram, dayIndex: number) {
  const day = program.days[dayIndex];
  if (!day) throw new Error('Program day not found.');
  if (day.exercises.some((exercise) => !exercise.exerciseTemplateId)) {
    throw new Error('Resolve every exercise to a synchronized Hevy template before writing it.');
  }
  return day;
}

export function buildRoutinePayload(
  program: TrainingProgram,
  dayIndex: number,
): HevyRoutinePayload {
  const day = assertDay(program, dayIndex);
  return {
    routine: {
      title: day.title || `${program.title} · Day ${day.day}`,
      folder_id: null,
      notes: `${program.title}\n${day.focus}\nProgression: ${program.progression}`,
      source: 'chatgpt',
      exercises: day.exercises.map((exercise) => ({
        exercise_template_id: exercise.exerciseTemplateId as string,
        superset_id: null,
        rest_seconds: exercise.restSeconds,
        notes: `${exercise.note} ${exercise.rationale}`.trim(),
        sets: Array.from({ length: exercise.sets }, () => ({
          type: 'normal' as const,
          weight_kg: exercise.startingLoadKg,
          reps: null,
          distance_meters: null,
          duration_seconds: null,
          custom_metric: null,
          rep_range: {
            start: exercise.repRange[0],
            end: exercise.repRange[1],
          },
        })),
      })),
    },
  };
}

export async function createConfirmationToken(
  userId: string,
  programId: string,
  dayIndex: number,
  payload: HevyRoutinePayload,
  now = Date.now(),
) {
  const payloadHash = await sha256(JSON.stringify(payload));
  const envelope = {
    userId,
    programId,
    dayIndex,
    payloadHash,
    expiresAt: now + CONFIRMATION_TTL_MS,
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(envelope)));
  const signature = base64Url(await hmac(encoded));
  return {
    token: `${encoded}.${signature}`,
    expiresAt: envelope.expiresAt,
  };
}

export async function verifyConfirmationToken(
  token: string,
  userId: string,
  programId: string,
  dayIndex: number,
  payload: HevyRoutinePayload,
  now = Date.now(),
) {
  try {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return false;
    const expected = await hmac(encoded);
    if (!constantTimeEqual(expected, fromBase64Url(signature))) return false;
    const envelope = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as {
      userId?: string;
      programId?: string;
      dayIndex?: number;
      payloadHash?: string;
      expiresAt?: number;
    };
    return (
      envelope.userId === userId &&
      envelope.programId === programId &&
      envelope.dayIndex === dayIndex &&
      typeof envelope.expiresAt === 'number' &&
      envelope.expiresAt >= now &&
      envelope.payloadHash === (await sha256(JSON.stringify(payload)))
    );
  } catch {
    return false;
  }
}

export async function writeRoutine(
  apiKey: string,
  program: TrainingProgram,
  dayIndex: number,
) {
  const payload = buildRoutinePayload(program, dayIndex);
  const client = createHevyClient(apiKey);
  const existingId = program.days[dayIndex]?.hevyRoutineId ?? null;
  const response = existingId && client.routinesUpdate
    ? await client.routinesUpdate(existingId, {
        routine: {
          title: payload.routine.title,
          notes: payload.routine.notes,
          source: payload.routine.source,
          exercises: payload.routine.exercises,
        },
      })
    : client.routinesCreate
      ? await client.routinesCreate(payload)
      : null;
  if (!response) throw new Error('Hevy routine write is not available.');
  const routineId = response.routine?.id ?? response.id;
  if (!routineId) throw new Error('Hevy did not return a routine id.');
  return { payload, routineId };
}

export function programWithRoutineId(
  program: TrainingProgram,
  dayIndex: number,
  routineId: string,
) {
  return {
    schemaVersion: 2 as const,
    title: program.title,
    goal: program.goal,
    durationWeeks: program.durationWeeks,
    daysPerWeek: program.daysPerWeek,
    minutesPerSession: program.minutesPerSession,
    overview: program.overview,
    progression: program.progression,
    deload: program.deload,
    days: program.days.map((day, index) =>
      index === dayIndex ? { ...day, hevyRoutineId: routineId } : day,
    ),
  } satisfies Omit<TrainingProgram, 'id' | 'createdAt'>;
}

export const routineConfirmationTtlMs = CONFIRMATION_TTL_MS;
