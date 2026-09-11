import { getDashboardData } from '@/lib/hevy';
import { generateProgramWithCoach } from '@/lib/openrouter';
import { buildFallbackProgram, type ProgramRequest } from '@/lib/program';
import { requestUserId } from '@/lib/request-user';
import { getProfile, listPrograms, saveProgram, type TrainingProgram } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function cleanRequest(value: Partial<ProgramRequest>): ProgramRequest {
  return {
    goal: String(value.goal || 'Build muscle and strength').slice(0, 300),
    durationWeeks: Math.min(24, Math.max(4, Math.round(Number(value.durationWeeks) || 8))),
    daysPerWeek: Math.min(7, Math.max(2, Math.round(Number(value.daysPerWeek) || 4))),
    minutesPerSession: Math.min(120, Math.max(25, Math.round(Number(value.minutesPerSession) || 60))),
    preferences: String(value.preferences || '').slice(0, 1000),
  };
}

function validProgram(value: unknown): value is Omit<TrainingProgram, 'id' | 'createdAt'> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TrainingProgram>;
  return Boolean(candidate.title && candidate.overview && candidate.progression && Array.isArray(candidate.days) && candidate.days.length);
}

export async function GET(request: Request) {
  try {
    return Response.json({ programs: await listPrograms(requestUserId(request.headers)) });
  } catch {
    return Response.json({ error: 'Saved programs are temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const input = cleanRequest(await request.json());
    const userId = requestUserId(request.headers);
    const [profile, dashboard] = await Promise.all([getProfile(userId), getDashboardData()]);
    let generated: Omit<TrainingProgram, 'id' | 'createdAt'> | null = null;
    try {
      const candidate = await generateProgramWithCoach(profile, dashboard, input);
      if (validProgram(candidate)) {
        generated = {
          ...candidate,
          goal: input.goal,
          durationWeeks: input.durationWeeks,
          daysPerWeek: input.daysPerWeek,
          minutesPerSession: input.minutesPerSession,
        };
      }
    } catch {
      generated = null;
    }
    const program = await saveProgram(userId, generated ?? buildFallbackProgram(input, profile, dashboard));
    return Response.json({ program }, { status: 201 });
  } catch {
    return Response.json({ error: 'The program could not be generated.' }, { status: 503 });
  }
}
