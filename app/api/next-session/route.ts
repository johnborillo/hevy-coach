import { getDashboardData } from '@/lib/hevy';
import { resolveNextSession } from '@/lib/program-next';
import { requestUserId } from '@/lib/request-user';
import { getProfile, getProgram, listPrograms } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const userId = requestUserId(request.headers);
    const params = new URL(request.url).searchParams;
    const programId = params.get('programId');
    const requestedDay = params.get('dayIndex');
    const [profile, dashboard, program] = await Promise.all([
      getProfile(userId),
      getDashboardData(userId),
      programId ? getProgram(userId, programId) : listPrograms(userId).then((items) => items[0] ?? null),
    ]);
    if (!program) return Response.json({ error: 'Program not found.' }, { status: 404 });
    const session = resolveNextSession(
      program,
      dashboard,
      profile,
      requestedDay == null ? undefined : Number(requestedDay),
    );
    if (!session) return Response.json({ error: 'This program has no training days.' }, { status: 422 });
    return Response.json({ session });
  } catch {
    return Response.json({ error: 'The next session is temporarily unavailable.' }, { status: 503 });
  }
}
