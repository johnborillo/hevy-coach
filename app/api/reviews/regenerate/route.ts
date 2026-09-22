import { requestUserId } from '@/lib/request-user';
import { closedWeekStart, generateWeeklyReview } from '@/lib/review';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      weekStart?: unknown;
    };
    const weekStart =
      typeof body.weekStart === 'string' &&
      Number.isFinite(new Date(body.weekStart).getTime())
        ? new Date(body.weekStart).toISOString()
        : closedWeekStart().toISOString();
    return Response.json({
      review: await generateWeeklyReview(
        requestUserId(request.headers),
        weekStart,
        { force: true },
      ),
    });
  } catch {
    return Response.json(
      { error: 'Weekly review could not be regenerated.' },
      { status: 400 },
    );
  }
}
