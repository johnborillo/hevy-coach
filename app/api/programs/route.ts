import { getDashboardData } from '@/lib/hevy';
import { adjustProgramWithCoach, generateProgramWithCoach } from '@/lib/openrouter';
import type { ProgramRequest } from '@/lib/program';
import { buildContinuationProgram } from '@/lib/program-continuation';
import { normalizeProgramV2, type ProgramMetadata } from '@/lib/program-v2';
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

function normalizeProgram(
  value: unknown,
  metadata: ProgramMetadata,
  profile: Awaited<ReturnType<typeof getProfile>>,
  dashboard: Awaited<ReturnType<typeof getDashboardData>>,
) {
  return normalizeProgramV2(value, metadata, profile, dashboard);
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
    const [profile, dashboard, savedPrograms] = await Promise.all([
      getProfile(userId),
      getDashboardData(userId),
      listPrograms(userId),
    ]);
    let generated: Omit<TrainingProgram, 'id' | 'createdAt'> | null = null;
    try {
      const candidate = await generateProgramWithCoach(
        profile,
        dashboard,
        input,
        savedPrograms[0] ?? null,
      );
      generated = normalizeProgram(candidate, input, profile, dashboard);
      if (!generated) {
        console.warn(
          'Generated program failed validation; no program was saved',
          { goal: input.goal, daysPerWeek: input.daysPerWeek },
        );
      }
    } catch (error) {
      console.error('Program AI failed; trying a continuation program', {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
    if (!generated) {
      const { listStoredHevyWorkouts, listStoredTemplates } =
        await import('@/lib/hevy-repo');
      const { deserializeHevyTemplate } = await import('@/lib/hevy-store');
      const { listMuscleOverrides } = await import('@/lib/muscle-repo');
      const [workouts, templateRows, overrides] = await Promise.all([
        listStoredHevyWorkouts(userId, { limit: 300 }),
        listStoredTemplates(userId),
        listMuscleOverrides(userId),
      ]);
      const continuation = buildContinuationProgram(
        input,
        profile,
        dashboard,
        workouts,
        templateRows.map(deserializeHevyTemplate),
        overrides,
      );
      generated = continuation
        ? normalizeProgram(continuation, input, profile, dashboard)
        : null;
    }
    if (!generated) {
      return Response.json(
        {
          error:
            'Program generation needs the AI provider right now — retry.',
        },
        { status: 503 },
      );
    }
    const program = await saveProgram(userId, generated);
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
    const [profile, dashboard] = await Promise.all([
      getProfile(userId),
      getDashboardData(userId),
    ]);
    if (body.adjustment) {
      const adjustment = String(body.adjustment).trim().slice(0, 1600);
      if (!adjustment) {
        return Response.json(
          { error: 'Tell Rowan what to change.' },
          { status: 400 },
        );
      }
      const candidate = await adjustProgramWithCoach(
        profile,
        dashboard,
        existing,
        adjustment,
      );
      nextProgram = normalizeProgram(candidate, existing, profile, dashboard);
    } else if (body.program) {
      nextProgram = normalizeProgram(body.program, existing, profile, dashboard);
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
