import { aggregateMetrics, metricsToCsv } from '@/lib/coach-metrics';
import {
  coachMetricsEnabled,
  listCoachTurnMetrics,
} from '@/lib/coach-metrics-repo';
import { requestUserId } from '@/lib/request-user';

export const dynamic = 'force-dynamic';

// Dev-only token report for the signed-in user's coach conversations.
// GET ?days=30            → aggregated JSON
// GET ?days=30&format=csv → one row per turn
// GET ?format=raw         → full rows, including per-pass completions
export async function GET(request: Request) {
  if (!coachMetricsEnabled()) {
    return Response.json(
      { error: 'Coach metrics are off. Set COACH_METRICS=1 to enable them.' },
      { status: 404 },
    );
  }
  try {
    const params = new URL(request.url).searchParams;
    const days = Number(params.get('days') ?? 30);
    const since = Number.isFinite(days) && days > 0
      ? new Date(Date.now() - days * 86_400_000).toISOString()
      : '';
    const rows = await listCoachTurnMetrics(requestUserId(request.headers), {
      since,
      limit: Number(params.get('limit') ?? 1000),
    });
    const format = params.get('format');
    if (format === 'csv') {
      return new Response(metricsToCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="coach-turn-metrics.csv"',
        },
      });
    }
    if (format === 'raw') return Response.json({ rows });
    return Response.json(aggregateMetrics(rows));
  } catch {
    return Response.json(
      { error: 'Coach metrics are unavailable.' },
      { status: 503 },
    );
  }
}
