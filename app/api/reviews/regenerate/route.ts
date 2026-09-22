import { requestUserId } from '@/lib/request-user';
import { closedWeekStart, generateWeeklyReview } from '@/lib/review';
import { getProfile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

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
    return Response.json({
      review: await generateWeeklyReview(userId, weekStart, { force: true }),
    });
  } catch {
    return Response.json(
      { error: 'Weekly review could not be regenerated.' },
      { status: 400 },
    );
  }
}
