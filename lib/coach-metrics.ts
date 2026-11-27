// Dev-only token accounting for coach turns. Pure helpers live here; the
// D1 reads and writes live in coach-metrics-repo.ts. No message or answer
// text is ever stored: only sizes, models, timings and token counts.
import { asksAboutRecentTraining, resolveRelativeDates } from './coach-clock';
import type { CoachAskTelemetry } from './openrouter';

/** Rough tokenizer-free estimate; calibrated against real usage per turn. */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export type PromptEstimate = {
  estimatedTokens: number;
  historyMessages: number;
  sections: Record<string, number>;
};

/**
 * Split the first pass's prompt into sections: the system prompt, each
 * top-level key of the training context, and prior conversation turns.
 */
export function estimatePrompt(input: {
  systemPrompt: string;
  contextMessage: string;
  contextJson: string;
  history: Array<{ content: string }>;
}): PromptEstimate {
  const sections: Record<string, number> = {
    systemPrompt: estimateTokens(input.systemPrompt),
  };
  let contextSectionTotal = 0;
  try {
    const parsed = JSON.parse(input.contextJson) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const tokens = estimateTokens(JSON.stringify(value) ?? '');
      sections[`context.${key}`] = tokens;
      contextSectionTotal += tokens;
    }
  } catch {
    // An unparseable context is still counted below as framing.
  }
  sections['context.framing'] = Math.max(
    0,
    estimateTokens(input.contextMessage) - contextSectionTotal,
  );
  sections.history = input.history.reduce(
    (total, message) => total + estimateTokens(message.content),
    0,
  );
  return {
    estimatedTokens: Object.values(sections).reduce((a, b) => a + b, 0),
    historyMessages: input.history.length,
    sections,
  };
}

export type QuestionKind =
  | 'session_review'
  | 'readiness'
  | 'planning'
  | 'progress'
  | 'date_specific'
  | 'general';

export function classifyQuestion(question: string, today: string): QuestionKind {
  const text = question.toLowerCase();
  if (/\b(should i (train|lift|rest|skip)|recover(ed|y)?|sore|rest day|ready (for|to)|fatigue|tired)\b/.test(text))
    return 'readiness';
  if (/\b(what should i (do|train)|plan|program|routine|next (session|workout)|build me|schedule)\b/.test(text))
    return 'planning';
  const relative = resolveRelativeDates(text, today).length > 0;
  if ((relative || asksAboutRecentTraining(text)) && /\b(how (was|did|is)|review|go|went|feedback)\b/.test(text))
    return 'session_review';
  if (/\b(plateau|stall|progress|pr|record|stronger|e1rm|1rm|improv)/.test(text))
    return 'progress';
  if (relative || /\b20\d{2}-\d{2}-\d{2}\b/.test(text)) return 'date_specific';
  return 'general';
}

export type CoachTurnMetric = {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string | null;
  createdAt: string;
  feature: 'chat';
  questionKind: QuestionKind;
  requestedModel: string;
  servedModel: string | null;
  outcome: 'ai' | 'evidence-engine';
  passes: number;
  requests: number;
  historyMessages: number;
  estimatedPromptTokens: number | null;
  promptTokens: number | null;
  firstPassPromptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cost: number | null;
  totalMs: number | null;
  sections: Record<string, number>;
  completions: Array<{
    pass: number;
    kind: string | null;
    model: string | null;
    promptTokens: number | null;
    cachedTokens: number | null;
    completionTokens: number | null;
    reasoningTokens: number | null;
    cost: number | null;
    durationMs: number | null;
  }>;
};

function sum(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

export function buildTurnMetric(input: {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string | null;
  createdAt: string;
  question: string;
  today: string;
  requestedModel: string;
  servedModel: string | null;
  telemetry: CoachAskTelemetry;
  totalMs: number | null;
}): CoachTurnMetric {
  const completions = input.telemetry.completions.map((item) => ({
    pass: item.pass,
    kind: item.kind ?? null,
    model: item.model ?? null,
    promptTokens: item.completion?.promptTokens ?? null,
    cachedTokens: item.completion?.cachedTokens ?? null,
    completionTokens: item.completion?.completionTokens ?? null,
    reasoningTokens: item.completion?.reasoningTokens ?? null,
    cost: item.completion?.cost ?? null,
    durationMs: item.completion?.durationMs ?? null,
  }));
  const estimate = input.telemetry.promptEstimate;
  return {
    id: input.id,
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    createdAt: input.createdAt,
    feature: 'chat',
    questionKind: classifyQuestion(input.question, input.today),
    requestedModel: input.requestedModel,
    servedModel: input.servedModel,
    outcome: input.servedModel === 'evidence-engine' ? 'evidence-engine' : 'ai',
    passes: input.telemetry.passes,
    requests: completions.length,
    historyMessages: estimate?.historyMessages ?? 0,
    estimatedPromptTokens: estimate?.estimatedTokens ?? null,
    promptTokens: sum(completions.map((item) => item.promptTokens)),
    firstPassPromptTokens: completions[0]?.promptTokens ?? null,
    cachedTokens: sum(completions.map((item) => item.cachedTokens)),
    completionTokens: sum(completions.map((item) => item.completionTokens)),
    reasoningTokens: sum(completions.map((item) => item.reasoningTokens)),
    cost: sum(completions.map((item) => item.cost)),
    totalMs: input.totalMs,
    sections: estimate?.sections ?? {},
    completions,
  };
}

function average(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length
    ? Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10
    : null;
}

function round(value: number | null, digits = 6) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function groupStats(rows: CoachTurnMetric[]) {
  return {
    turns: rows.length,
    avgPromptTokens: average(rows.map((row) => row.firstPassPromptTokens)),
    maxPromptTokens: rows.reduce<number | null>(
      (max, row) =>
        row.firstPassPromptTokens == null
          ? max
          : Math.max(max ?? 0, row.firstPassPromptTokens),
      null,
    ),
    avgCompletionTokens: average(rows.map((row) => row.completionTokens)),
    avgReasoningTokens: average(rows.map((row) => row.reasoningTokens)),
    totalCost: round(sum(rows.map((row) => row.cost))),
    avgRequestsPerTurn: average(rows.map((row) => row.requests)),
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return groups;
}

/** Rows newest-first, as listed by the repo. */
export function aggregateMetrics(rows: CoachTurnMetric[]) {
  const promptTotal = sum(rows.map((row) => row.promptTokens));
  const cachedTotal = sum(rows.map((row) => row.cachedTokens));
  const calibration = rows
    .filter((row) => row.firstPassPromptTokens && row.estimatedPromptTokens)
    .map((row) => (row.firstPassPromptTokens as number) / (row.estimatedPromptTokens as number));
  const ratio = calibration.length
    ? calibration.reduce((a, b) => a + b, 0) / calibration.length
    : null;
  const sectionNames = [...new Set(rows.flatMap((row) => Object.keys(row.sections)))];
  const sectionTotals = sectionNames
    .map((name) => {
      const avgEstimated = average(rows.map((row) => row.sections[name] ?? 0)) ?? 0;
      return {
        section: name,
        avgEstimatedTokens: avgEstimated,
        avgCalibratedTokens: ratio == null ? null : Math.round(avgEstimated * ratio),
      };
    })
    .sort((a, b) => b.avgEstimatedTokens - a.avgEstimatedTokens);
  const estimatedSum = sectionTotals.reduce((total, item) => total + item.avgEstimatedTokens, 0);
  return {
    turns: rows.length,
    from: rows.at(-1)?.createdAt ?? null,
    to: rows[0]?.createdAt ?? null,
    overall: {
      ...groupStats(rows),
      cacheHitRate:
        promptTotal && cachedTotal != null ? round(cachedTotal / promptTotal, 3) : null,
      // Real prompt tokens per estimated token; multiply section estimates by it.
      estimateCalibration: round(ratio, 3),
      evidenceEngineTurns: rows.filter((row) => row.outcome === 'evidence-engine').length,
    },
    sections: sectionTotals.map((item) => ({
      ...item,
      share: estimatedSum ? round(item.avgEstimatedTokens / estimatedSum, 3) : null,
    })),
    byConversation: [...groupBy(rows, (row) => row.conversationId)].map(
      ([conversationId, items]) => {
        const chronological = [...items].reverse();
        return {
          conversationId,
          ...groupStats(items),
          firstTurnPromptTokens: chronological[0]?.firstPassPromptTokens ?? null,
          lastTurnPromptTokens: chronological.at(-1)?.firstPassPromptTokens ?? null,
          maxHistoryMessages: Math.max(...items.map((row) => row.historyMessages)),
          lastTurnAt: items[0]?.createdAt ?? null,
        };
      },
    ),
    byModel: [...groupBy(rows, (row) => row.servedModel ?? row.requestedModel)].map(
      ([model, items]) => ({ model, ...groupStats(items) }),
    ),
    byQuestionKind: [...groupBy(rows, (row) => row.questionKind)].map(
      ([questionKind, items]) => ({ questionKind, ...groupStats(items) }),
    ),
    byHistoryLength: [
      ...groupBy(rows, (row) =>
        row.historyMessages <= 1
          ? '1'
          : row.historyMessages <= 4
            ? '2-4'
            : row.historyMessages <= 8
              ? '5-8'
              : '9-12',
      ),
    ]
      .map(([historyMessages, items]) => ({ historyMessages, ...groupStats(items) }))
      .sort((a, b) => a.historyMessages.localeCompare(b.historyMessages, 'en', { numeric: true })),
  };
}

const CSV_COLUMNS = [
  'createdAt',
  'conversationId',
  'messageId',
  'questionKind',
  'requestedModel',
  'servedModel',
  'outcome',
  'passes',
  'requests',
  'historyMessages',
  'estimatedPromptTokens',
  'firstPassPromptTokens',
  'promptTokens',
  'cachedTokens',
  'completionTokens',
  'reasoningTokens',
  'cost',
  'totalMs',
] as const;

function csvCell(value: unknown) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function metricsToCsv(rows: CoachTurnMetric[]) {
  const sectionNames = [...new Set(rows.flatMap((row) => Object.keys(row.sections)))].sort();
  const header = [...CSV_COLUMNS, ...sectionNames.map((name) => `section:${name}`)];
  const lines = rows.map((row) =>
    [
      ...CSV_COLUMNS.map((column) => row[column]),
      ...sectionNames.map((name) => row.sections[name] ?? ''),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
