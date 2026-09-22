import { buildRoutinePayload, createConfirmationToken } from '@/lib/hevy-write';
import { requestUserId } from '@/lib/request-user';
import { getProgram } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { programId?: string; dayIndex?: number };
    const programId = String(body.programId || '');
    const dayIndex = Math.round(Number(body.dayIndex));
    if (!programId || !Number.isInteger(dayIndex) || dayIndex < 0) {
      return Response.json({ error: 'A program and valid day are required.' }, { status: 400 });
    }
    const userId = requestUserId(request.headers);
    const program = await getProgram(userId, programId);
    if (!program) return Response.json({ error: 'Program not found.' }, { status: 404 });
    let payload;
    try {
      payload = buildRoutinePayload(program, dayIndex);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'This day is not ready to write.' },
        { status: 422 },
      );
    }
    const confirmation = await createConfirmationToken(userId, programId, dayIndex, payload);
    return Response.json({
      payload,
      confirmationToken: confirmation.token,
      expiresAt: new Date(confirmation.expiresAt).toISOString(),
    });
  } catch {
    return Response.json({ error: 'Routine preview is temporarily unavailable.' }, { status: 503 });
  }
}
