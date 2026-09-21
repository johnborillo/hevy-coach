import { requestUserId } from '@/lib/request-user';
import { syncHevy } from '@/lib/hevy-sync';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const apiKey = process.env.HEVY_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'HEVY_API_KEY is not configured.' },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };
    const result = await syncHevy(requestUserId(request.headers), apiKey, {
      force: Boolean(body.force),
      maxFullSyncPages: 3,
    });
    return Response.json(result);
  } catch (error) {
    console.error('Hevy sync failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'Hevy could not be synchronized right now.' },
      { status: 502 },
    );
  }
}
