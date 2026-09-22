import { deriveAnalysis } from '@/lib/derive';
import { requestUserId } from '@/lib/request-user';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const result = await deriveAnalysis(
      requestUserId(request.headers),
      'manual',
    );
    return Response.json(result);
  } catch (error) {
    console.error('Manual analysis refresh failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'The analysis could not be refreshed.' },
      { status: 500 },
    );
  }
}
