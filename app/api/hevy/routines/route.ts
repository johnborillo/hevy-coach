import {
  buildRoutinePayload,
  programWithRoutineId,
  verifyConfirmationToken,
  writeRoutine,
} from '@/lib/hevy-write';
import { requestUserId } from '@/lib/request-user';
import { getProgram, updateProgram } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      programId?: string;
      dayIndex?: number;
      confirmationToken?: string;
    };
    const programId = String(body.programId || '');
    const dayIndex = Math.round(Number(body.dayIndex));
    const confirmationToken = String(body.confirmationToken || '');
    if (!programId || !Number.isInteger(dayIndex) || dayIndex < 0 || !confirmationToken) {
      return Response.json({ error: 'A program, day, and confirmation are required.' }, { status: 400 });
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
    const valid = await verifyConfirmationToken(
      confirmationToken,
      userId,
      programId,
      dayIndex,
      payload,
    );
    if (!valid) return Response.json({ error: 'The routine preview has expired or changed. Preview it again.' }, { status: 403 });
    const apiKey = process.env.HEVY_API_KEY;
    if (!apiKey) return Response.json({ error: 'Hevy is not connected.' }, { status: 503 });
    const result = await writeRoutine(apiKey, program, dayIndex);
    const saved = await updateProgram(
      userId,
      programId,
      programWithRoutineId(program, dayIndex, result.routineId),
    );
    return Response.json({ routineId: result.routineId, program: saved });
  } catch (error) {
    console.error('Hevy routine write failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json({ error: 'Hevy could not save this routine right now.' }, { status: 502 });
  }
}
