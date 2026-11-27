import { getDatabase } from '@/db';
import type { CoachTurnMetric } from './coach-metrics';

/** Dev-only: token accounting runs only when COACH_METRICS=1. */
export function coachMetricsEnabled() {
  return process.env.COACH_METRICS === '1';
}

/**
 * Store one turn's metrics. Never throws: a metrics failure must not
 * affect the athlete's answer.
 */
export async function recordCoachTurnMetric(metric: CoachTurnMetric) {
  if (!coachMetricsEnabled()) return;
  try {
    await getDatabase()
      .prepare(
        `INSERT INTO coach_turn_metrics (
          id, user_id, conversation_id, message_id, created_at, feature,
          question_kind, requested_model, served_model, outcome, passes,
          requests, history_messages, estimated_prompt_tokens, prompt_tokens,
          first_pass_prompt_tokens, cached_tokens, completion_tokens,
          reasoning_tokens, cost, total_ms, sections_json, completions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        metric.id,
        metric.userId,
        metric.conversationId,
        metric.messageId,
        metric.createdAt,
        metric.feature,
        metric.questionKind,
        metric.requestedModel,
        metric.servedModel,
        metric.outcome,
        metric.passes,
        metric.requests,
        metric.historyMessages,
        metric.estimatedPromptTokens,
        metric.promptTokens,
        metric.firstPassPromptTokens,
        metric.cachedTokens,
        metric.completionTokens,
        metric.reasoningTokens,
        metric.cost,
        metric.totalMs,
        JSON.stringify(metric.sections),
        JSON.stringify(metric.completions),
      )
      .run();
  } catch (error) {
    console.warn('Coach turn metrics could not be saved', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

type MetricRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  message_id: string | null;
  created_at: string;
  feature: string;
  question_kind: string;
  requested_model: string;
  served_model: string | null;
  outcome: string;
  passes: number;
  requests: number;
  history_messages: number;
  estimated_prompt_tokens: number | null;
  prompt_tokens: number | null;
  first_pass_prompt_tokens: number | null;
  cached_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  cost: number | null;
  total_ms: number | null;
  sections_json: string;
  completions_json: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Newest first. */
export async function listCoachTurnMetrics(
  userId: string,
  options: { limit?: number; since?: string } = {},
): Promise<CoachTurnMetric[]> {
  const limit = Math.min(Math.max(options.limit ?? 1000, 1), 5000);
  const result = await getDatabase()
    .prepare(
      `SELECT * FROM coach_turn_metrics
       WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, options.since ?? '', limit)
    .all<MetricRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    feature: 'chat',
    questionKind: row.question_kind as CoachTurnMetric['questionKind'],
    requestedModel: row.requested_model,
    servedModel: row.served_model,
    outcome: row.outcome === 'evidence-engine' ? 'evidence-engine' : 'ai',
    passes: row.passes,
    requests: row.requests,
    historyMessages: row.history_messages,
    estimatedPromptTokens: row.estimated_prompt_tokens,
    promptTokens: row.prompt_tokens,
    firstPassPromptTokens: row.first_pass_prompt_tokens,
    cachedTokens: row.cached_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    cost: row.cost,
    totalMs: row.total_ms,
    sections: parseJson(row.sections_json, {}),
    completions: parseJson(row.completions_json, []),
  }));
}
