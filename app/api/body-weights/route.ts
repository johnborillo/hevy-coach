import { requestUserId } from '@/lib/request-user';
import {
  listBodyWeights,
  saveBodyWeight,
  summarizeBodyWeight,
} from '@/lib/body-weight-repo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const points = await listBodyWeights(requestUserId(request.headers));
    return Response.json({ points, summary: summarizeBodyWeight(points) });
  } catch {
    return Response.json(
      { error: 'Body weight history is unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      weightKg?: unknown;
      measuredAt?: unknown;
    };
    const weightKg = Number(body.weightKg);
    if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 350) {
      return Response.json(
        { error: 'Enter a body weight between 30 and 350 kg.' },
        { status: 400 },
      );
    }
    const measuredAt =
      typeof body.measuredAt === 'string' &&
      Number.isFinite(new Date(body.measuredAt).getTime())
        ? new Date(body.measuredAt).toISOString()
        : new Date().toISOString();
    const point = await saveBodyWeight(
      requestUserId(request.headers),
      Math.round(weightKg * 100) / 100,
      measuredAt,
    );
    return Response.json({ point }, { status: 201 });
  } catch {
    return Response.json(
      { error: 'Body weight could not be saved.' },
      { status: 400 },
    );
  }
}
