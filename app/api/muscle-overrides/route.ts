import { saveMuscleOverride } from '@/lib/muscle-repo';
import { isMuscle, type Muscle } from '@/lib/muscles';
import { requestUserId } from '@/lib/request-user';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      exerciseTemplateId?: unknown;
      primaryMuscle?: unknown;
      secondaryMuscles?: unknown;
    };
    const exerciseTemplateId =
      typeof body.exerciseTemplateId === 'string'
        ? body.exerciseTemplateId.trim()
        : '';
    if (!exerciseTemplateId || !isMuscle(body.primaryMuscle)) {
      return Response.json(
        { error: 'Choose a valid muscle.' },
        { status: 400 },
      );
    }
    const secondaryMuscles = Array.isArray(body.secondaryMuscles)
      ? body.secondaryMuscles.filter((muscle): muscle is Muscle =>
          isMuscle(muscle),
        )
      : [];
    const muscleOverride = await saveMuscleOverride(
      requestUserId(request.headers),
      {
        exerciseTemplateId,
        primaryMuscle: body.primaryMuscle,
        secondaryMuscles,
        countsAs: 1,
      },
    );
    return Response.json({ muscleOverride });
  } catch (error) {
    console.error('Muscle override save failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'Muscle mapping could not be saved.' },
      { status: 400 },
    );
  }
}
