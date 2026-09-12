import { getDashboardData } from '@/lib/hevy';
import { adjustProgramWithCoach, generateProgramWithCoach } from '@/lib/openrouter';
import { buildFallbackProgram, type ProgramRequest } from '@/lib/program';
import { requestUserId } from '@/lib/request-user';
import {
  deleteProgram,
  getProfile,
  getProgram,
  listPrograms,
  saveProgram,
  updateProgram,
  type TrainingProgram,
} from '@/lib/storage';

export const dynamic = 'force-dynamic';

function cleanRequest(value: Partial<ProgramRequest>): ProgramRequest {
  return {
    goal: String(value.goal || 'Build muscle and strength').slice(0, 300),
    durationWeeks: Math.min(
      24,
      Math.max(4, Math.round(Number(value.durationWeeks) || 8)),
    ),
    daysPerWeek: Math.min(
      7,
      Math.max(2, Math.round(Number(value.daysPerWeek) || 4)),
    ),
    minutesPerSession: Math.min(
      120,
      Math.max(25, Math.round(Number(value.minutesPerSession) || 60)),
    ),
    preferences: String(value.preferences || '').slice(0, 1000),
  };
}

type ProgramMetadata = Pick<
  TrainingProgram,
  'goal' | 'durationWeeks' | 'daysPerWeek' | 'minutesPerSession'
>;

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function isLowerGoal(goal: string) {
  return /\b(leg|legs|lower|quad|hamstring|glute|calf)\b/i.test(goal);
}

function isGoalAligned(
  program: Omit<TrainingProgram, 'id' | 'createdAt'>,
  goal: string,
) {
  if (!isLowerGoal(goal)) return true;
  const exerciseNames = program.days
    .flatMap((day) =>
      day.exercises.map((exercise) => `${exercise.name} ${exercise.note}`),
    )
    .join(' ');
  const lowerMatches =
    exerciseNames.match(
      /quad|hamstring|glute|calf|leg|lower|squat|deadlift|lunge|hip/gi,
    )?.length ?? 0;
  const totalExercises = program.days.reduce(
    (total, day) => total + day.exercises.length,
    0,
  );
  return (
    totalExercises > 0 &&
    lowerMatches >= Math.max(2, Math.ceil(totalExercises / 2))
  );
}

function normalizeProgram(value: unknown, metadata: ProgramMetadata) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TrainingProgram>;
  if (
    !Array.isArray(candidate.days) ||
    candidate.days.length !== metadata.daysPerWeek
  ) {
    return null;
  }
  const days = candidate.days.map((rawDay, dayIndex) => {
    if (!rawDay || typeof rawDay !== 'object') return null;
    const day = rawDay as Partial<TrainingProgram['days'][number]>;
    if (!Array.isArray(day.exercises) || day.exercises.length === 0) return null;
    const exercises = day.exercises.map((rawExercise) => {
      if (!rawExercise || typeof rawExercise !== 'object') return null;
      const exercise =
        rawExercise as Partial<
          TrainingProgram['days'][number]['exercises'][number]
        >;
      const sets = Number(exercise.sets);
      const restSeconds = Number(exercise.restSeconds);
      const name = text(exercise.name);
      if (
        !name ||
        !Number.isFinite(sets) ||
        !Number.isFinite(restSeconds)
      ) {
        return null;
      }
      return {
        name: name.slice(0, 120),
        sets: Math.min(10, Math.max(1, Math.round(sets))),
        reps: text(exercise.reps, '6–12').slice(0, 40),
        effort: text(exercise.effort, '2–3 RIR').slice(0, 40),
        restSeconds: Math.min(600, Math.max(30, Math.round(restSeconds))),
        note: text(exercise.note, 'Use a controlled effort.').slice(0, 240),
      };
    });
    if (exercises.some((exercise) => !exercise)) return null;
    return {
      day: Number.isFinite(Number(day.day))
        ? Math.max(1, Math.round(Number(day.day)))
        : dayIndex + 1,
      title: text(day.title, `Session ${dayIndex + 1}`).slice(0, 100),
      focus: text(day.focus, 'Balanced development').slice(0, 140),
      exercises: exercises as NonNullable<(typeof exercises)[number]>[],
    };
  });
  if (days.some((day) => !day)) return null;

  const normalized = {
    title: text(
      candidate.title,
      `${metadata.durationWeeks}-Week Training Block`,
    ).slice(0, 160),
    goal: metadata.goal,
    durationWeeks: metadata.durationWeeks,
    daysPerWeek: metadata.daysPerWeek,
    minutesPerSession: metadata.minutesPerSession,
    overview: text(
      candidate.overview,
      'A tailored training block built around your constraints.',
    ).slice(0, 800),
    progression: text(
      candidate.progression,
      'Progress reps within the prescribed range before adding the smallest practical load.',
    ).slice(0, 800),
    deload: text(
      candidate.deload,
      'Reduce sets when performance, motivation, or recovery has clearly deteriorated.',
    ).slice(0, 800),
    days: days as NonNullable<(typeof days)[number]>[],
  } satisfies Omit<TrainingProgram, 'id' | 'createdAt'>;
  return isGoalAligned(normalized, metadata.goal) ? normalized : null;
}

export async function GET(request: Request) {
  try {
    return Response.json({
      programs: await listPrograms(requestUserId(request.headers)),
    });
  } catch {
    return Response.json(
      { error: 'Saved programs are temporarily unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = cleanRequest(await request.json());
    const userId = requestUserId(request.headers);
    const [profile, dashboard] = await Promise.all([
      getProfile(userId),
      getDashboardData(),
    ]);
    let generated: Omit<TrainingProgram, 'id' | 'createdAt'> | null = null;
    try {
      const candidate = await generateProgramWithCoach(profile, dashboard, input);
      generated = normalizeProgram(candidate, input);
      if (!generated) {
        console.warn(
          'Generated program failed validation; using a goal-aware fallback',
          { goal: input.goal, daysPerWeek: input.daysPerWeek },
        );
      }
    } catch (error) {
      console.error('Program AI failed; using a goal-aware fallback', {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
    const program = await saveProgram(
      userId,
      generated ?? buildFallbackProgram(input, profile, dashboard),
    );
    return Response.json({ program }, { status: 201 });
  } catch {
    return Response.json(
      { error: 'The program could not be generated.' },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      adjustment?: string;
      program?: unknown;
    };
    const id = String(body.id || '');
    if (!id) {
      return Response.json({ error: 'Program id is required.' }, { status: 400 });
    }
    const userId = requestUserId(request.headers);
    const existing = await getProgram(userId, id);
    if (!existing) {
      return Response.json({ error: 'Program not found.' }, { status: 404 });
    }

    let nextProgram: Omit<TrainingProgram, 'id' | 'createdAt'> | null = null;
    if (body.adjustment) {
      const adjustment = String(body.adjustment).trim().slice(0, 1600);
      if (!adjustment) {
        return Response.json(
          { error: 'Tell Rowan what to change.' },
          { status: 400 },
        );
      }
      const [profile, dashboard] = await Promise.all([
        getProfile(userId),
        getDashboardData(),
      ]);
      const candidate = await adjustProgramWithCoach(
        profile,
        dashboard,
        existing,
        adjustment,
      );
      nextProgram = normalizeProgram(candidate, existing);
    } else if (body.program) {
      nextProgram = normalizeProgram(body.program, existing);
    } else {
      return Response.json(
        { error: 'Provide edits or an adjustment request.' },
        { status: 400 },
      );
    }

    if (!nextProgram) {
      return Response.json(
        { error: 'The revised program did not match the saved block structure.' },
        { status: 422 },
      );
    }
    const program = await updateProgram(userId, id, nextProgram);
    if (!program) {
      return Response.json({ error: 'Program could not be saved.' }, { status: 404 });
    }
    return Response.json({ program });
  } catch (error) {
    console.error('Program update failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'The program could not be updated right now.' },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!id) {
      return Response.json({ error: 'Program id is required.' }, { status: 400 });
    }
    const deleted = await deleteProgram(requestUserId(request.headers), id);
    if (!deleted) {
      return Response.json({ error: 'Program not found.' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: 'The program could not be deleted right now.' },
      { status: 503 },
    );
  }
}

