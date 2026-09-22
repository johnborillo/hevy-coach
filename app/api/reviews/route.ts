import { requestUserId } from '@/lib/request-user';
import { closedWeekStart, listReviewHistory } from '@/lib/review';
import { getProfile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 12);
    return Response.json({
      reviews: await listReviewHistory(requestUserId(request.headers), limit),
    });
  } catch {
    return Response.json(
      { error: 'Weekly review history is unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = requestUserId(request.headers);
    const body = (await request.json().catch(() => ({}))) as {
      weekStart?: unknown;
    };
    const profile = await getProfile(userId);
    const weekStart =
      typeof body.weekStart === 'string' &&
      Number.isFinite(new Date(body.weekStart).getTime())
        ? new Date(body.weekStart).toISOString()
        : closedWeekStart(new Date(), profile.timezone).toISOString();
    const { generateWeeklyReview } = await import('@/lib/review');
    return Response.json({
      review: await generateWeeklyReview(userId, weekStart, { force: true }),
    });
  } catch {
    return Response.json(
      { error: 'Weekly review could not be generated.' },
      { status: 400 },
    );
  }
}
