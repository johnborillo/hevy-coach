import type { DashboardData } from './hevy';
import type { AthleteProfile, ChatMessage, TrainingProgram } from './storage';
import {
  COACH_MODELS,
  DEFAULT_COACH_ID,
  DEFAULT_COACH_MODEL,
  type CoachId,
  type CoachModelId,
  type CoachMessageFlags,
} from './coach-options';
import { buildCoachContext, SUMMARY_FIELDS } from './coach-context';
import {
  buildProgramContext,
  programGenerationPrompt,
} from './program-generate';
import type { TurnTimer } from './coach-telemetry';
import type { searchStoredNotes } from './notes-repo';
import { chatRequestOptions, programRequestOptions } from './model-capabilities';
import { parseOpenRouterStream } from './openrouter-stream';

export const COACH_TURN_BUDGET_MS = 75_000;

class CoachBudgetExceededError extends Error {
  constructor() {
    super('The AI model took too long to respond.');
    this.name = 'CoachBudgetExceededError';
  }
}

const SUMMARY_CITATION_GUIDE = SUMMARY_FIELDS.map(
  (field) => `[Hevy summary: ${field}]`,
).join(', ');

const COACH_PERSONA = `You are Rowan, a highly experienced strength and physique coach who has trained recreational lifters and competitive athletes for more than 15 years. You are thoughtful, warm, lucid, and evidence-led. You care about adherence, progressive overload, fatigue management, technique quality, and the athlete's actual constraints.

Voice and structure:
- Write like a perceptive coach having a real conversation: calm, collaborative, nuanced, and candid.
- Lead with the useful answer, then explain the reasoning in clear natural prose.
- Use short headings and lists only when they genuinely make the answer easier to scan. Avoid a robotic checklist for every reply.
- Anticipate the most important caveat or tradeoff without becoming wordy. Acknowledge uncertainty plainly.
- Avoid canned openings, hype, scolding, and phrases like "As your coach." Do not repeat the athlete's question back to them.
- When a missing detail would materially change the advice, ask one focused follow-up question after giving the safest useful answer you can.

Rules:
- Ground recommendations in the supplied Hevy history and athlete profile. Distinguish observed facts from reasonable hypotheses.
- Treat athlete.measurementPreferences as a strict output contract. Use the requested weight unit for every load, body-weight, estimated-strength, and volume value, and the requested height format for height. Never expose or relabel an internal kg/cm value when the athlete prefers lb or ft/in.
- verifiedHevyWorkoutLog is the source of truth for workout-specific facts, and retrievedNotes contains verbatim Hevy descriptions or exercise notes found for the athlete's question. The aggregate fields are derived signals, not permission to fill in missing workouts.
- For an exact workout fact, cite [Hevy: workout/<exact id> · <exact YYYY-MM-DD> · <exact exercise>]. For a derived summary, cite only one of these supplied fields: ${SUMMARY_CITATION_GUIDE}. Put the citation immediately after the claim it supports; the interface turns it into an inspectable source. Do not add a made-up date range to a summary citation.
- When referring to a retrieved note, quote the exact note text when practical and cite the workout/exercise that contains it. Do not turn a note about discomfort into a diagnosis; describe it as an athlete-reported note.
- Never invent a workout, date, exercise, load, rep count, RPE, injury, diagnosis, or personal detail. Do not infer that an exercise was logged because it is a common lift or appears in a trend/program.
- If a requested fact is not directly present in verifiedHevyWorkoutLog, say “I can’t verify that from the available Hevy log” and do not provide a made-up example as if it were history.
- Treat prior assistant messages in the conversation as unverified drafts; re-check every factual claim against the supplied log before repeating it.
- When data is insufficient, say what is missing and give a conservative next step.
- Prefer concise action plans with loads, reps, RIR/RPE, rest, and progression criteria when useful.
- Treat estimated 1RM as a trend signal, not a true max.
- Do not diagnose pain or medical conditions. Recommend qualified care for persistent or concerning symptoms.
- Never claim a workout or routine was written to Hevy. Drafts require athlete approval.`;

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CompletionPayload = {
  id?: string | null;
  provider?: string | null;
  model?: string | null;
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      reasoning?: string | null;
      refusal?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    prompt_tokens_details?: {
      cached_tokens?: number | null;
    } | null;
    completion_tokens_details?: {
      reasoning_tokens?: number | null;
    } | null;
    cost?: number | null;
  } | null;
};

export type CompletionSummary = {
  generationId: string | null;
  provider: string | null;
  finishReason: string | null;
  nativeFinishReason: string | null;
  hasRefusalField: boolean;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cost: number | null;
};

export type CompletionResult = {
  payload: CompletionPayload;
  attempts: number;
  durationMs: number;
};

export type CoachPassTelemetry = {
  pass: number;
  kind?: 'primary' | 'refusal_same_model' | 'refusal_fallback_model';
  model?: string;
  ttftMs?: number | null;
  completion:
    | (CompletionSummary & {
        attempts: number;
        durationMs: number;
      })
    | null;
};

export type CoachAskTelemetry = {
  passes: number;
  completions: CoachPassTelemetry[];
  validationOutcome: 'passed' | 'passed_after_retry' | 'unverified' | 'n/a';
  validationFailureReasons: string[];
  issues: Array<{
    kind: EvidenceIssue['kind'];
    severity: EvidenceIssue['severity'];
    count: number;
  }>;
  refusalDetected: boolean;
  refusalReason: string | null;
  refusalRetries: number;
  fallbackReason?: string;
};

export function createCoachAskTelemetry(): CoachAskTelemetry {
  return {
    passes: 0,
    completions: [],
    validationOutcome: 'n/a',
    validationFailureReasons: [],
    issues: [],
    refusalDetected: false,
    refusalReason: null,
    refusalRetries: 0,
  };
}

export function summarizeCompletion(
  payload: CompletionPayload,
): CompletionSummary {
  const choice = payload.choices?.[0];
  const message = choice?.message;
  return {
    generationId: payload.id ?? null,
    provider: payload.provider ?? null,
    finishReason: choice?.finish_reason ?? null,
    nativeFinishReason: choice?.native_finish_reason ?? null,
    hasRefusalField:
      message !== undefined &&
      Object.prototype.hasOwnProperty.call(message, 'refusal'),
    promptTokens: payload.usage?.prompt_tokens ?? null,
    cachedTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? null,
    completionTokens: payload.usage?.completion_tokens ?? null,
    reasoningTokens:
      payload.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    cost: payload.usage?.cost ?? null,
  };
}

const REFUSAL_TEXT_PATTERNS = [
  /^(?:I['’]m sorry|I apolog(?:ize|ise)|Sorry)[,.]?\s.*\b(?:can['’]?t|cannot|unable to|not able to)\b.*\b(?:help|assist|comply|provide|answer)\b/i,
  /^I\s+(?:can['’]?t|cannot|won['’]?t)\s+(?:help|assist)\s+with\s+(?:that|this)\b/i,
];

export function detectRefusal(
  payload: CompletionPayload | null,
  content: string,
): string | null {
  const message = payload?.choices?.[0]?.message;
  if (typeof message?.refusal === 'string' && message.refusal.trim()) {
    return 'refusal_field';
  }
  const finishReason = payload?.choices?.[0]?.finish_reason;
  const nativeFinishReason = payload?.choices?.[0]?.native_finish_reason;
  if (
    finishReason === 'content_filter' ||
    nativeFinishReason === 'content_filter'
  ) {
    return 'content_filter';
  }
  const trimmed = content.trim();
  if (trimmed.length >= 280) return null;
  if (REFUSAL_TEXT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'refusal_text';
  }
  return null;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 524, 529]);

class OpenRouterRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | number | null,
  ) {
    super(message);
  }
}

export class EvidenceMismatchError extends Error {
  readonly code = 'EVIDENCE_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'EvidenceMismatchError';
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response | null, attempt: number) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 3500);
    const dateDelay = new Date(retryAfter).getTime() - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0)
      return Math.min(dateDelay, 3500);
  }
  return Math.min(450 * 2 ** attempt + Math.random() * 250, 2500);
}

export async function requestCompletionWithTelemetry(
  body: Record<string, unknown>,
  timeoutMs: number,
  deadlineMs?: number,
): Promise<CompletionResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response | null = null;
    try {
      const remainingMs =
        deadlineMs === undefined
          ? timeoutMs
          : Math.min(timeoutMs, deadlineMs - Date.now());
      if (remainingMs <= 0) throw new CoachBudgetExceededError();
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Hevy Coach',
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(remainingMs),
      });

      if (response.ok) {
        const payload = (await response.json()) as CompletionPayload;
        const message = payload.choices?.[0]?.message;
        const content = message?.content;
        if (payload.choices?.[0]?.finish_reason === 'length') {
          console.warn('OpenRouter completion reached max_tokens', {
            generationId: payload.id ?? null,
            model: payload.model ?? body.model ?? null,
            attempt: attempt + 1,
          });
        }
        const hasContent =
          (typeof content === 'string' && content.trim().length > 0) ||
          (Array.isArray(content) &&
            content.some(
              (part) => typeof part.text === 'string' && part.text.trim(),
            ));

        // OpenRouter can return HTTP 200 with a zero-token/empty completion.
        // Treat that as transient so a provider hiccup does not immediately
        // send the athlete to the local evidence engine.
        if (!hasContent) {
          if (attempt === 2) {
            throw new OpenRouterRequestError(
              'OpenRouter returned an empty response',
              502,
              null,
            );
          }
          console.warn('Retrying an empty OpenRouter response', {
            attempt: attempt + 1,
            finishReason: payload.choices?.[0]?.finish_reason ?? null,
            hadReasoning: Boolean(message?.reasoning),
          });
          await wait(retryDelay(response, attempt));
          continue;
        }
        return {
          payload,
          attempts: attempt + 1,
          durationMs: Math.max(0, Date.now() - startedAt),
        };
      }

      const detail = (await response.json().catch(() => null)) as {
        error?: { code?: string | number; message?: string };
      } | null;
      const providerError = new OpenRouterRequestError(
        detail?.error?.message || `OpenRouter returned ${response.status}`,
        response.status,
        detail?.error?.code ?? null,
      );
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) {
        throw providerError;
      }
      console.warn('Retrying a transient OpenRouter response', {
        attempt: attempt + 1,
        status: providerError.status,
        code: providerError.code,
      });
      await wait(retryDelay(response, attempt));
    } catch (error) {
      if (error instanceof OpenRouterRequestError) throw error;
      if (error instanceof CoachBudgetExceededError) throw error;
      if (attempt >= 1) throw error;
      console.warn('Retrying an interrupted OpenRouter request', {
        attempt: attempt + 1,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      await wait(retryDelay(response, attempt));
    }
  }
  throw new Error('OpenRouter retries were exhausted');
}

export async function requestCompletion(
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const result = await requestCompletionWithTelemetry(body, timeoutMs);
  return result?.payload ?? null;
}

export async function requestStreamingCompletionWithTelemetry(
  body: Record<string, unknown>,
  timeoutMs: number,
  onDelta: (text: string) => void,
  deadlineMs?: number,
): Promise<CompletionResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response | null = null;
    try {
      const remainingMs =
        deadlineMs === undefined
          ? timeoutMs
          : Math.min(timeoutMs, deadlineMs - Date.now());
      if (remainingMs <= 0) throw new CoachBudgetExceededError();
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Hevy Coach',
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: AbortSignal.timeout(remainingMs),
      });
      if (response.ok && response.body) {
        const parsed = await parseOpenRouterStream(response.body, onDelta);
        return {
          payload: parsed.payload,
          attempts: attempt + 1,
          durationMs: Math.max(0, Date.now() - startedAt),
        };
      }
      const detail = (await response.json().catch(() => null)) as {
        error?: { code?: string | number; message?: string };
      } | null;
      const error = new OpenRouterRequestError(
        detail?.error?.message || `OpenRouter returned ${response.status}`,
        response.status,
        detail?.error?.code ?? null,
      );
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) throw error;
      await wait(retryDelay(response, attempt));
    } catch (error) {
      if (error instanceof OpenRouterRequestError || error instanceof CoachBudgetExceededError) throw error;
      if (attempt >= 1) throw error;
      await wait(retryDelay(response, attempt));
    }
  }
  throw new Error('OpenRouter streaming retries were exhausted');
}

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? content;
  const start = source.indexOf('{');
  if (start < 0) throw new Error('The model did not return a JSON object');

  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('The model returned incomplete JSON');
  const candidate = source.slice(start, end);
  return JSON.parse(candidate) as Omit<TrainingProgram, 'id' | 'createdAt'>;
}

export function messageContent(payload: CompletionPayload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

function normalizeDate(value: string) {
  const match = value.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function numberTokens(value: string) {
  return [...value.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => ({
    token: match[0],
    value: Number(match[0]),
    index: match.index ?? 0,
  }));
}

export type EvidenceIssue = {
  kind:
    | 'wrong_unit'
    | 'unknown_summary_citation'
    | 'unmatched_workout_citation'
    | 'unsupported_date'
    | 'unsupported_lift'
    | 'unsupported_number';
  severity: 'hard' | 'soft';
  sentence: string;
  tokens: string[];
  message: string;
};

const HISTORY_PATTERN =
  /\byour\b|\byou(?:'ve| have)?\s+(?:logged|did|hit|lifted|pressed|squatted|averaged|completed|ran|trained)\b|\blast\s+(?:session|week|workout|time)\b|\b(?:is|was|were)\s+at\b|\baverag(?:e|ed|ing)\b|\btrend\b|\be1rm\b|\bestimated\s+1rm\b|\bpr\b|\bpersonal\s+record\b|\bsessions?\s+(?:this|last)\b/i;

function sentenceUnits(content: string) {
  const withCitationBreaks = content.replace(
    /(\[Hevy(?: summary)?:\s*[^\]]+\])\s+(?=[A-Z0-9])/gi,
    '$1\n',
  );
  const units: string[] = [];
  for (const line of withCitationBreaks.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pieces = trimmed.split(/(?<=[.!?])\s+(?!\[Hevy(?: summary)?:)/i);
    for (const piece of pieces) {
      const sentence = piece.trim();
      if (sentence) units.push(sentence);
    }
  }
  return units;
}

function firstJsonObject(value: string) {
  const start = value.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(value.slice(start, index + 1)) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function nestedValue(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function evidenceForSentence(sentence: string, evidenceText: string) {
  const citation = sentence.match(/\[Hevy summary:\s*([^\]]+)\]/i)?.[1];
  if (!citation) return evidenceText;
  const root = firstJsonObject(evidenceText);
  if (!root) return evidenceText;
  const normalized = citation.toLowerCase().replace(/[^a-z]/g, '');
  const path =
    normalized === 'bodyweighttrend'
      ? ['athlete', 'bodyWeightTrend']
      : normalized === 'activetrainingblock'
        ? ['athlete', 'activeTrainingBlock']
        : [citation.trim()];
  const scoped = nestedValue(root, path);
  if (scoped === null) return evidenceText;
  const jsonEnd = evidenceText.indexOf('}') + 1;
  return `${JSON.stringify(scoped)}\n${jsonEnd > 0 ? evidenceText.slice(jsonEnd) : ''}`;
}

function numbersMatch(claimed: number, evidence: number[]) {
  return evidence.some(
    (value) =>
      claimed === value ||
      claimed === Math.round(value) ||
      claimed === Math.round(value * 10) / 10 ||
      Math.abs(claimed - value) <= 0.005 * Math.abs(value),
  );
}

function unsupportedNumberIssues(sentence: string, evidenceText: string) {
  const evidenceNumbers = numberTokens(evidenceText).map((item) => item.value);
  const computedPercentages = new Set<number>();
  for (const numerator of evidenceNumbers) {
    for (const denominator of evidenceNumbers) {
      if (!denominator) continue;
      computedPercentages.add(
        Math.round((numerator / denominator) * 1000) / 10,
      );
      computedPercentages.add(
        Math.round(((numerator - denominator) / denominator) * 1000) / 10,
      );
    }
  }
  const historicalYear =
    /\b(?:on|logged|you did|session on|workout on)\s+(?:[^\d]{0,18})20\d{2}\b/i;
  const unsupported = numberTokens(sentence).filter((item) => {
    if (item.value <= 12) return false;
    if (
      item.value >= 2000 &&
      item.value <= 2100 &&
      !historicalYear.test(sentence)
    )
      return false;
    if (numbersMatch(item.value, evidenceNumbers)) return false;
    const suffix = sentence.slice(item.index + item.token.length).trimStart();
    return !(suffix.startsWith('%') && computedPercentages.has(item.value));
  });
  if (!unsupported.length) return null;
  const tokens = [...new Set(unsupported.map((item) => item.token))];
  return {
    kind: 'unsupported_number' as const,
    severity: 'soft' as const,
    sentence,
    tokens,
    message: `The draft included unsupported numbers: ${tokens.join(', ')}`,
  } satisfies EvidenceIssue;
}

function issue(
  kind: EvidenceIssue['kind'],
  sentence: string,
  tokens: string[],
  message: string,
): EvidenceIssue {
  return { kind, severity: 'hard', sentence, tokens, message };
}

export function collectEvidenceIssues(
  content: string,
  dashboard: DashboardData,
  profile: AthleteProfile,
  evidenceText = '',
): EvidenceIssue[] {
  const knownDates = new Set(
    dashboard.calendarWorkouts.map((workout) => workout.date),
  );
  const knownExerciseText = dashboard.calendarWorkouts
    .flatMap((workout) =>
      workout.exercises.map((exercise) => exercise.title.toLowerCase()),
    )
    .join(' ');
  const normalizeCitation = (value: string) =>
    value.toLowerCase().replace(/[^a-z]/g, '');
  const summaryFields = new Set(SUMMARY_FIELDS.map(normalizeCitation));
  const units = sentenceUnits(content);
  const issues: EvidenceIssue[] = [];
  for (const sentence of units) {
    const wrongWeightPattern =
      profile.weightUnit === 'lb'
        ? /\b\d+(?:\.\d+)?\s*(?:kg|kgs|kilograms?)\b/gi
        : /\b\d+(?:\.\d+)?\s*(?:lb|lbs|pounds?)\b/gi;
    const wrongWeight = [...sentence.matchAll(wrongWeightPattern)].filter(
      (match) =>
        !/\b(?:plates?|bumpers?|kettlebells?|kb)\b/i.test(
          sentence.slice(
            match.index ?? 0,
            (match.index ?? 0) + match[0].length + 24,
          ),
        ),
    );
    if (wrongWeight.length) {
      issues.push(
        issue(
          'wrong_unit',
          sentence,
          wrongWeight.map((match) => match[0]),
          `The draft did not follow the athlete's ${profile.weightUnit} measurement preference.`,
        ),
      );
    }
    if (
      profile.heightUnit === 'imperial' &&
      /\b\d+(?:\.\d+)?\s*(?:cm|centimetres?|centimeters?)\b/i.test(sentence)
    ) {
      issues.push(
        issue(
          'wrong_unit',
          sentence,
          [
            sentence.match(
              /\b\d+(?:\.\d+)?\s*(?:cm|centimetres?|centimeters?)\b/i,
            )?.[0] ?? 'cm',
          ],
          "The draft did not follow the athlete's feet-and-inches height preference.",
        ),
      );
    }
    const historicalDateMatches = [
      ...sentence.matchAll(
        /\b(?:on|logged|you did|session on|workout on)\s+(?:[^\d]{0,18})(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/gi,
      ),
    ].map((match) => match[1]);
    const unsupportedDates = [...new Set(historicalDateMatches)]
      .map(normalizeDate)
      .filter((date): date is string => date !== null && !knownDates.has(date));
    if (unsupportedDates.length) {
      issues.push(
        issue(
          'unsupported_date',
          sentence,
          unsupportedDates,
          `The draft cited dates absent from the synchronized Hevy log: ${unsupportedDates.join(', ')}`,
        ),
      );
    }
    const summaryCitations = [
      ...sentence.matchAll(/\[Hevy summary:\s*([^\]]+)\]/gi),
    ].map((match) => match[1]);
    for (const citation of summaryCitations) {
      if (!summaryFields.has(normalizeCitation(citation))) {
        issues.push(
          issue(
            'unknown_summary_citation',
            sentence,
            [citation],
            `The draft cited an unknown Hevy summary field: ${citation}`,
          ),
        );
      }
    }
    const citations = [...sentence.matchAll(/\[Hevy:\s*([^\]]+)\]/gi)].map(
      (match) => match[1],
    );
    for (const citation of citations) {
      const match = citation.match(
        /^(?:workout\/)?([^·]+?)\s*·\s*(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\s*·\s*(.+)$/,
      );
      const workoutId = match?.[1]?.trim();
      const citedDate = match ? normalizeDate(match[2]) : null;
      const exerciseTitle = match?.[3]?.trim().toLowerCase();
      const citedWorkout = dashboard.calendarWorkouts.find(
        (workout) => workout.id === workoutId && workout.date === citedDate,
      );
      const citedExercise = citedWorkout?.exercises.some(
        (exercise) => exercise.title.toLowerCase() === exerciseTitle,
      );
      if (!citedWorkout || !citedExercise) {
        issues.push(
          issue(
            'unmatched_workout_citation',
            sentence,
            [citation],
            `The draft contained a Hevy citation that could not be matched exactly to a verified workout and exercise: ${citation}`,
          ),
        );
      }
    }
    for (const lift of ['squat', 'deadlift']) {
      if (knownExerciseText.includes(lift)) continue;
      const unsupportedLift =
        new RegExp(
          `\\b(?:your|the)\\s+(?:barbell\\s+)?${lift}\\s+(?:is|was|has|had|numbers?|progress|stalled|regressing|increased|decreased|moved|went)\\b`,
          'i',
        ).test(sentence) ||
        new RegExp(`\\byou\\s+(?:squatted|deadlifted)\\b`, 'i').test(sentence);
      if (unsupportedLift) {
        issues.push(
          issue(
            'unsupported_lift',
            sentence,
            [lift],
            `The draft treated ${lift} as a logged lift, but no ${lift} exercise exists in the synchronized Hevy log.`,
          ),
        );
      }
    }
    const hasCitation = /\[Hevy(?: summary)?:/i.test(sentence);
    const isClaim =
      hasCitation ||
      (HISTORY_PATTERN.test(sentence) && numberTokens(sentence).length > 0);
    if (evidenceText && isClaim) {
      const numberIssue = unsupportedNumberIssues(
        sentence,
        evidenceForSentence(sentence, evidenceText),
      );
      if (numberIssue) issues.push(numberIssue);
    }
  }
  return issues;
}

export function validateGroundedNumbers(content: string, evidenceText: string) {
  const issue = unsupportedNumberIssues(content, evidenceText);
  if (issue) throw new EvidenceMismatchError(issue.message);
}

export function validateCoachEvidence(
  content: string,
  dashboard: DashboardData,
  profile: AthleteProfile,
  evidenceText = '',
) {
  const firstIssue = collectEvidenceIssues(
    content,
    dashboard,
    profile,
    evidenceText,
  )[0];
  if (firstIssue) throw new EvidenceMismatchError(firstIssue.message);
}

const LEGACY_UNVERIFIED_FOOTER =
  '*Some figures in this answer could not be verified against your synchronized Hevy log.*';

function coachModelLabel(model: string) {
  return COACH_MODELS.find((item) => item.id === model)?.label ?? model;
}

function isPrivacyProviderError(error: unknown) {
  return (
    error instanceof Error &&
    /no provider|data[_ -]?collection|privacy|endpoint/i.test(error.message)
  );
}

function refusalFallbackModel(requestedModel: string) {
  return (
    COACH_MODELS.find((item) => item.id !== requestedModel)?.id ??
    DEFAULT_COACH_MODEL
  );
}

function coachFlags(
  requestedModel: string,
  servedModel: string,
  notice: string | null,
  passes: number,
  refusal = false,
  validation?: CoachMessageFlags['validation'],
  issues: EvidenceIssue[] = [],
): CoachMessageFlags | null {
  if (
    !notice &&
    !refusal &&
    !validation &&
    requestedModel === servedModel &&
    passes <= 1
  ) {
    return null;
  }
  const unverified =
    validation === 'unverified'
      ? issues.slice(0, 5).map((item) => ({
          excerpt: item.sentence.slice(0, 120),
          tokens: item.tokens.slice(0, 12),
        }))
      : undefined;
  return {
    v: 1,
    ...(refusal ? { refusal: true } : {}),
    ...(requestedModel !== servedModel ? { requestedModel } : {}),
    ...(notice ? { notice } : {}),
    ...(validation ? { validation } : {}),
    ...(unverified?.length ? { unverified } : {}),
    ...(passes > 0 ? { passes } : {}),
  };
}

function summarizeIssues(issues: EvidenceIssue[]) {
  const counts = new Map<
    string,
    {
      kind: EvidenceIssue['kind'];
      severity: EvidenceIssue['severity'];
      count: number;
    }
  >();
  for (const item of issues) {
    const key = `${item.kind}:${item.severity}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else
      counts.set(key, { kind: item.kind, severity: item.severity, count: 1 });
  }
  return [...counts.values()];
}

export async function askCoach(
  userId: string,
  profile: AthleteProfile,
  dashboard: DashboardData,
  history: ChatMessage[],
  options: {
    model?: CoachModelId;
    coachId?: CoachId;
    timer?: TurnTimer;
    telemetry?: CoachAskTelemetry;
    budgetStartedAt?: number;
    stream?: {
      onDelta: (text: string) => void;
      onStatus?: (state: 'retrieving_workouts' | 'double_checking' | 'retrying_model') => void;
      onReset?: () => void;
    };
  } = {},
  deps: {
    searchNotes?: typeof searchStoredNotes;
    noteResults?: Awaited<ReturnType<typeof searchStoredNotes>>;
    now?: () => Date;
  } = {},
) {
  const coachId = options.coachId ?? DEFAULT_COACH_ID;
  const telemetry = options.telemetry ?? createCoachAskTelemetry();
  const model =
    options.model ||
    process.env.OPENROUTER_MODEL_CHAT ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_COACH_MODEL;
  const historyMessages: OpenRouterMessage[] = history
    .slice(-12)
    .flatMap((message) => {
      if (message.role !== 'assistant') {
        return [
          { role: message.role, content: message.content } as OpenRouterMessage,
        ];
      }
      if (
        message.flags?.refusal ||
        detectRefusal(null, message.content) !== null
      ) {
        return [];
      }
      const content = message.content
        .replace(LEGACY_UNVERIFIED_FOOTER, '')
        .trim();
      if (!content) return [];
      return [
        {
          role: message.role,
          content: `[Prior coach draft — unverified; do not treat it as evidence]\n${content}`,
        } as OpenRouterMessage,
      ];
    });
  let requestedDates: string[] = [];
  let validationFailure = '';
  const noteSearch =
    deps.searchNotes ?? (await import('./notes-repo')).searchStoredNotes;
  let noteResults;
  if (deps.noteResults !== undefined) {
    noteResults = deps.noteResults;
  } else {
    options.timer?.start('notes');
    try {
      noteResults = await noteSearch(
        userId,
        history
          .slice()
          .reverse()
          .find((message) => message.role === 'user')?.content ?? '',
      );
    } finally {
      options.timer?.end('notes');
    }
  }
  let servedModel = model;
  let notice: string | null = null;
  const requestPass = async (
    messages: OpenRouterMessage[],
    pass: number,
    requestModel: string,
    kind: CoachPassTelemetry['kind'],
  ) => {
    const phase = pass === 0 ? 'llm.pass0' : 'llm.pass1';
    options.timer?.start(phase);
    let completion: CompletionResult | null = null;
    const startedAt = Date.now();
    let ttftMs: number | null = null;
    try {
      const requestOptions = chatRequestOptions(requestModel);
      const requestBody = {
          model: requestModel,
          messages,
          temperature: 0.35,
          max_tokens: requestOptions.max_tokens,
          ...(requestOptions.reasoning
            ? { reasoning: requestOptions.reasoning }
            : {}),
          provider: requestOptions.provider,
      };
      completion = options.stream
        ? await requestStreamingCompletionWithTelemetry(
            requestBody,
            requestOptions.timeoutMs,
            (text) => {
              ttftMs ??= Math.max(0, Date.now() - startedAt);
              options.stream?.onDelta(text);
            },
            options.budgetStartedAt === undefined
              ? undefined
              : options.budgetStartedAt + COACH_TURN_BUDGET_MS,
          )
        : await requestCompletionWithTelemetry(
            requestBody,
            requestOptions.timeoutMs,
            options.budgetStartedAt === undefined
              ? undefined
              : options.budgetStartedAt + COACH_TURN_BUDGET_MS,
          );
    } catch (error) {
      telemetry.completions.push({
        pass,
        kind,
        model: requestModel,
        ttftMs,
        completion: null,
      });
      if (requestModel.startsWith('deepseek/') && isPrivacyProviderError(error)) {
        telemetry.fallbackReason = `No provider for ${coachModelLabel(requestModel)} meets the privacy setting.`;
        return null;
      }
      if (error instanceof CoachBudgetExceededError) {
        telemetry.fallbackReason = 'The AI model took too long to respond.';
        return null;
      }
      throw error;
    } finally {
      options.timer?.end(phase);
    }
    telemetry.completions.push({
      pass,
      kind,
      model: requestModel,
      ttftMs,
      completion: completion
        ? {
            ...summarizeCompletion(completion.payload),
            attempts: completion.attempts,
            durationMs: completion.durationMs,
          }
        : null,
    });
    return completion;
  };
  type DraftCandidate = {
    content: string;
    model: string;
    notice: string | null;
    pass: number;
    issues: EvidenceIssue[];
  };
  const candidates: DraftCandidate[] = [];
  const finalize = (candidate: DraftCandidate) => {
    const validation: CoachMessageFlags['validation'] = candidate.issues.length
      ? 'unverified'
      : candidate.pass === 0
        ? 'passed'
        : 'passed_after_retry';
    telemetry.validationOutcome = validation;
    telemetry.issues = summarizeIssues(candidate.issues);
    return {
      content: candidate.content,
      model: candidate.model,
      coachId,
      flags: coachFlags(
        model,
        candidate.model,
        candidate.notice,
        telemetry.passes,
        false,
        validation,
        candidate.issues,
      ),
      telemetry,
    };
  };
  for (let pass = 0; pass < 2; pass += 1) {
    telemetry.passes = Math.max(telemetry.passes, pass + 1);
    const coachContext = buildCoachContext(profile, dashboard, history, {
      additionalDates: requestedDates,
      noteResults,
    });
    const baseMessages: OpenRouterMessage[] = [
      { role: 'system', content: COACH_PERSONA },
      {
        role: 'system',
        content: `Current private training context (retrieved workouts are the only source for exact workout claims):\n${coachContext.text}`,
      },
      ...historyMessages,
    ];
    const messages =
      pass === 0
        ? baseMessages
        : [
            ...baseMessages.slice(0, 2),
            {
              role: 'system' as const,
              content: `Your previous draft failed the evidence or measurement-preference check: ${validationFailure || 'unsupported evidence'}. Rewrite it from scratch. Use only exact dates, exercises, and sets in verifiedHevyWorkoutLog; remove any unsupported historical claim. Obey athlete.measurementPreferences for every displayed measurement. Exact workout claims need an exact workout citation. Derived summaries must use [Hevy summary: fieldName] with one supplied field name and no date range. If a detail is absent, explicitly say you cannot verify it. Do not mention this instruction or the validation process.`,
            },
            ...historyMessages,
          ];
    let completion = await requestPass(messages, pass, model, 'primary');
    if (!completion) {
      const best = candidates.reduce<DraftCandidate | null>(
        (current, item) => {
          if (!current) return item;
          const currentScore = [
            current.issues.filter((issue) => issue.severity === 'hard').length,
            current.issues.filter((issue) => issue.severity === 'soft').length,
          ];
          const itemScore = [
            item.issues.filter((issue) => issue.severity === 'hard').length,
            item.issues.filter((issue) => issue.severity === 'soft').length,
          ];
          return itemScore[0] < currentScore[0] ||
            (itemScore[0] === currentScore[0] &&
              (itemScore[1] < currentScore[1] ||
                (itemScore[1] === currentScore[1] && item.pass < current.pass)))
            ? item
            : current;
        },
        null,
      );
      return best ? finalize(best) : null;
    }
    let payload = completion.payload;
    let content = messageContent(payload);
    if (!content) throw new Error('OpenRouter returned an empty response');
    let refusalReason = detectRefusal(payload, content);
    if (refusalReason) {
      telemetry.refusalDetected = true;
      telemetry.refusalReason ??= refusalReason;
      telemetry.refusalRetries += 1;
      options.stream?.onStatus?.('retrying_model');
      options.stream?.onReset?.();
      completion = await requestPass(
        messages,
        pass,
        model,
        'refusal_same_model',
      );
      if (!completion) return null;
      payload = completion.payload;
      content = messageContent(payload);
      refusalReason = detectRefusal(payload, content);
      if (refusalReason) {
        telemetry.refusalRetries += 1;
        const fallbackModel = refusalFallbackModel(model);
        options.stream?.onStatus?.('retrying_model');
        options.stream?.onReset?.();
        completion = await requestPass(
          messages,
          pass,
          fallbackModel,
          'refusal_fallback_model',
        );
        if (!completion) return null;
        payload = completion.payload;
        content = messageContent(payload);
        refusalReason = detectRefusal(payload, content);
        if (refusalReason) {
          telemetry.fallbackReason =
            'The AI model declined to answer this question.';
          return null;
        }
        notice = `Answered by ${coachModelLabel(fallbackModel)} because ${coachModelLabel(model)} declined this question.`;
        servedModel = fallbackModel;
      }
    }
    servedModel = payload.model ?? servedModel;
    const needs = [
      ...content.matchAll(/\[NEED:\s*workout\s+(20\d{2}-\d{2}-\d{2})\]/gi),
    ].map((match) => match[1]);
    if (needs.length && pass === 0) {
      requestedDates = [...new Set(needs)];
      options.stream?.onStatus?.('retrieving_workouts');
      options.stream?.onReset?.();
      continue;
    }
    options.timer?.start('validate');
    let issues: EvidenceIssue[] = [];
    try {
      const recentConversationGrounding = history
        .slice(-2)
        .map((message) => message.content)
        .join('\n');
      issues = collectEvidenceIssues(
        content,
        dashboard,
        profile,
        `${coachContext.text}\n${recentConversationGrounding}`,
      );
    } finally {
      options.timer?.end('validate');
    }
    const candidate: DraftCandidate = {
      content: content.replace(
        /\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/gi,
        '',
      ),
      model: servedModel,
      notice,
      pass,
      issues,
    };
    candidates.push(candidate);
    if (!issues.length && pass === 0) return finalize(candidate);
    if (issues.length) {
      validationFailure = issues[0]?.message ?? 'unsupported evidence';
      telemetry.validationFailureReasons.push(
        ...issues.map((item) => item.message),
      );
      if (pass === 0) {
        console.warn(
          'Retrying a coach response that failed evidence validation',
          {
            reason: validationFailure,
          },
        );
        options.stream?.onStatus?.('double_checking');
        options.stream?.onReset?.();
        continue;
      }
    }
    if (pass === 1) {
      const score = (item: DraftCandidate) => [
        item.issues.filter((issue) => issue.severity === 'hard').length,
        item.issues.filter((issue) => issue.severity === 'soft').length,
      ];
      const better = candidates.reduce((best, item) => {
        const bestScore = score(best);
        const itemScore = score(item);
        if (itemScore[0] < bestScore[0]) return item;
        if (itemScore[0] > bestScore[0]) return best;
        if (itemScore[1] < bestScore[1]) return item;
        if (itemScore[1] > bestScore[1]) return best;
        return item.pass < best.pass ? item : best;
      });
      return finalize(better);
    }
  }
  const lastCandidate = candidates.at(-1);
  return lastCandidate ? finalize(lastCandidate) : null;
}

export async function generateProgramWithCoach(
  profile: AthleteProfile,
  dashboard: DashboardData,
  request: {
    goal: string;
    durationWeeks: number;
    daysPerWeek: number;
    minutesPerSession: number;
    preferences?: string;
  },
  currentProgram: TrainingProgram | null = null,
) {
  const model =
    process.env.OPENROUTER_MODEL_PROGRAM ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_COACH_MODEL;
  const requestOptions = programRequestOptions(model);
  const payload = await requestCompletion(
    {
      model,
      temperature: 0.2,
      max_tokens: requestOptions.max_tokens,
      ...(requestOptions.reasoning
        ? { reasoning: requestOptions.reasoning }
        : {}),
      ...(requestOptions.response_format
        ? { response_format: requestOptions.response_format }
        : {}),
      provider: requestOptions.provider,
      messages: [
        { role: 'system', content: COACH_PERSONA },
        {
          role: 'user',
          content: programGenerationPrompt(
            request,
            buildProgramContext(profile, dashboard, currentProgram),
          ),
        },
      ],
    },
    requestOptions.timeoutMs,
  );
  if (!payload) return null;
  const content = messageContent(payload);
  if (!content) throw new Error('OpenRouter returned an empty program');
  return extractJson(content);
}

export async function adjustProgramWithCoach(
  profile: AthleteProfile,
  dashboard: DashboardData,
  program: TrainingProgram,
  adjustment: string,
) {
  const model =
    process.env.OPENROUTER_MODEL_PROGRAM ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_COACH_MODEL;
  const requestOptions = programRequestOptions(model);
  const payload = await requestCompletion(
    {
      model,
      temperature: 0.15,
      max_tokens: requestOptions.max_tokens,
      ...(requestOptions.reasoning
        ? { reasoning: requestOptions.reasoning }
        : {}),
      ...(requestOptions.response_format
        ? { response_format: requestOptions.response_format }
        : {}),
      provider: requestOptions.provider,
      messages: [
        {
          role: 'system',
          content: `${COACH_PERSONA}\n\nFor this request, act as a careful program editor. Return only one valid JSON object using the exact program schema. Return the complete replacement program, not a patch or commentary. Preserve the program's duration, days, and session length unless the athlete explicitly asks to change them.`,
        },
        {
          role: 'user',
          content: `Adjust this saved training program according to the athlete's request. Keep useful exercises and progression logic where they still fit. Never invent an injury diagnosis. Return schemaVersion 2 JSON with the complete replacement program.\n\nAthlete request: ${adjustment}\n\nCurrent program:\n${JSON.stringify(program)}\n\nPrivate training context:\n${buildProgramContext(profile, dashboard, program)}\n\nUse the schema from the current program and keep startingLoadKg in kilograms.`,
        },
      ],
    },
    requestOptions.timeoutMs,
  );
  if (!payload) return null;
  const content = messageContent(payload);
  if (!content)
    throw new Error('OpenRouter returned an empty adjusted program');
  return extractJson(content);
}
