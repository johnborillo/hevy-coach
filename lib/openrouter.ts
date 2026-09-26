import type { DashboardData } from './hevy';
import type { AthleteProfile, ChatMessage, TrainingProgram } from './storage';
import {
  DEFAULT_COACH_ID,
  DEFAULT_COACH_MODEL,
  type CoachId,
  type CoachModelId,
} from './coach-options';
import { buildCoachContext, SUMMARY_FIELDS } from './coach-context';
import {
  buildProgramContext,
  programGenerationPrompt,
} from './program-generate';
import type { TurnTimer } from './coach-telemetry';

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
};

export function createCoachAskTelemetry(): CoachAskTelemetry {
  return {
    passes: 0,
    completions: [],
    validationOutcome: 'n/a',
    validationFailureReasons: [],
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
): Promise<CompletionResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Hevy Coach',
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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

export function validateGroundedNumbers(content: string, evidenceText: string) {
  const evidenceNumbers = numberTokens(evidenceText).map((item) => item.value);
  const allowed = new Set(evidenceNumbers);
  const historicalYear =
    /\b(?:on|logged|you did|session on|workout on)\s+(?:[^\d]{0,18})20\d{2}\b/i;
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
  const unsupported = numberTokens(content).filter((item) => {
    if (item.value <= 12) return false;
    if (
      item.value >= 2000 &&
      item.value <= 2100 &&
      !historicalYear.test(content)
    ) {
      return false;
    }
    if (allowed.has(item.value)) return false;
    const suffix = content.slice(item.index + item.token.length).trimStart();
    if (suffix.startsWith('%') && computedPercentages.has(item.value)) {
      return false;
    }
    return true;
  });
  if (unsupported.length) {
    throw new EvidenceMismatchError(
      `The draft included unsupported numbers: ${[...new Set(unsupported.map((item) => item.token))].join(', ')}`,
    );
  }
}

export function validateCoachEvidence(
  content: string,
  dashboard: DashboardData,
  profile: AthleteProfile,
  evidenceText = '',
) {
  const wrongWeightUnit =
    profile.weightUnit === 'lb'
      ? /\b\d+(?:\.\d+)?\s*(?:kg|kgs|kilograms?)\b/i
      : /\b\d+(?:\.\d+)?\s*(?:lb|lbs|pounds?)\b/i;
  if (wrongWeightUnit.test(content)) {
    throw new EvidenceMismatchError(
      `The draft did not follow the athlete's ${profile.weightUnit} measurement preference.`,
    );
  }
  if (
    profile.heightUnit === 'imperial' &&
    /\b(?:cm|centimetres?|centimeters?)\b/i.test(content)
  ) {
    throw new EvidenceMismatchError(
      "The draft did not follow the athlete's feet-and-inches height preference.",
    );
  }

  const knownDates = new Set(
    dashboard.calendarWorkouts.map((workout) => workout.date),
  );
  const historicalDateMatches = [
    ...content.matchAll(
      /\b(?:on|logged|you did|session on|workout on)\s+(?:[^\d]{0,18})(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/gi,
    ),
  ].map((match) => match[1]);
  const unsupportedDates = [...new Set(historicalDateMatches)]
    .map(normalizeDate)
    .filter((date): date is string => date !== null && !knownDates.has(date));
  if (unsupportedDates.length) {
    throw new EvidenceMismatchError(
      `The draft cited dates absent from the synchronized Hevy log: ${[...new Set(unsupportedDates)].join(', ')}`,
    );
  }

  const normalizeCitation = (value: string) =>
    value.toLowerCase().replace(/[^a-z]/g, '');
  const summaryFields = new Set(SUMMARY_FIELDS.map(normalizeCitation));
  const isSummaryCitation = (value: string) => {
    const normalized = normalizeCitation(value);
    return summaryFields.has(normalized);
  };

  const summaryCitations = [
    ...content.matchAll(/\[Hevy summary:\s*([^\]]+)\]/gi),
  ].map((match) => match[1]);
  for (const citation of summaryCitations) {
    if (!isSummaryCitation(citation)) {
      throw new EvidenceMismatchError(
        `The draft cited an unknown Hevy summary field: ${citation}`,
      );
    }
  }

  const citations = [...content.matchAll(/\[Hevy:\s*([^\]]+)\]/gi)].map(
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
      throw new EvidenceMismatchError(
        `The draft contained a Hevy citation that could not be matched exactly to a verified workout and exercise: ${citation}`,
      );
    }
  }

  const knownExerciseText = dashboard.calendarWorkouts
    .flatMap((workout) =>
      workout.exercises.map((exercise) => exercise.title.toLowerCase()),
    )
    .join(' ');
  for (const lift of ['squat', 'deadlift']) {
    if (knownExerciseText.includes(lift)) continue;
    const unsupportedLift =
      new RegExp(
        `\\b(?:your|the)\\s+(?:barbell\\s+)?${lift}\\s+(?:is|was|has|had|numbers?|progress|stalled|regressing|increased|decreased|moved|went)\\b`,
        'i',
      ).test(content) ||
      new RegExp(`\\byou\\s+(?:squatted|deadlifted)\\b`, 'i').test(content);
    if (unsupportedLift) {
      throw new EvidenceMismatchError(
        `The draft treated ${lift} as a logged lift, but no ${lift} exercise exists in the synchronized Hevy log.`,
      );
    }
  }
  if (evidenceText) validateGroundedNumbers(content, evidenceText);
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
    .map((message) => ({
      role: message.role,
      content:
        message.role === 'assistant'
          ? `[Prior coach draft — unverified; do not treat it as evidence]\n${message.content}`
          : message.content,
    }));
  let requestedDates: string[] = [];
  let lastDraft = '';
  let validationFailure = '';
  const { searchStoredNotes } = await import('./notes-repo');
  options.timer?.start('notes');
  let noteResults;
  try {
    noteResults = await searchStoredNotes(
      userId,
      history
        .slice()
        .reverse()
        .find((message) => message.role === 'user')?.content ?? '',
    );
  } finally {
    options.timer?.end('notes');
  }
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
        content: `Current private training context (retrieved workouts are the only source for exact workout claims; estimated prompt size ${coachContext.estimatedTokens} tokens):\n${coachContext.text}`,
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
    const phase = pass === 0 ? 'llm.pass0' : 'llm.pass1';
    options.timer?.start(phase);
    let completion: CompletionResult | null = null;
    try {
      completion = await requestCompletionWithTelemetry(
        {
          model,
          messages,
          temperature: 0.35,
          max_tokens: 2000,
          reasoning: { effort: 'medium' },
          provider: { data_collection: 'deny', allow_fallbacks: true },
        },
        45_000,
      );
    } catch (error) {
      telemetry.completions.push({ pass, completion: null });
      throw error;
    } finally {
      options.timer?.end(phase);
    }
    if (!completion) {
      telemetry.completions.push({ pass, completion: null });
      return null;
    }
    const { payload } = completion;
    telemetry.completions.push({
      pass,
      completion: {
        ...summarizeCompletion(payload),
        attempts: completion.attempts,
        durationMs: completion.durationMs,
      },
    });
    const content = messageContent(payload);
    if (!content) throw new Error('OpenRouter returned an empty response');
    lastDraft = content;
    const needs = [
      ...content.matchAll(/\[NEED:\s*workout\s+(20\d{2}-\d{2}-\d{2})\]/gi),
    ].map((match) => match[1]);
    if (needs.length && pass === 0) {
      requestedDates = [...new Set(needs)];
      continue;
    }
    options.timer?.start('validate');
    try {
      const recentConversationGrounding = history
        .slice(-2)
        .map((message) => message.content)
        .join('\n');
      validateCoachEvidence(
        content,
        dashboard,
        profile,
        `${coachContext.text}\n${recentConversationGrounding}`,
      );
      telemetry.validationOutcome =
        pass === 0 ? 'passed' : 'passed_after_retry';
      return {
        content: content.replace(
          /\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/gi,
          '',
        ),
        model: payload.model ?? model,
        coachId,
        telemetry,
      };
    } catch (error) {
      if (!(error instanceof EvidenceMismatchError)) throw error;
      validationFailure = error.message;
      telemetry.validationFailureReasons.push(error.message);
      if (pass === 1) {
        telemetry.validationOutcome = 'unverified';
        return {
          content: `${lastDraft}\n\n*Some figures in this answer could not be verified against your synchronized Hevy log.*`,
          model: payload.model ?? model,
          coachId,
          telemetry,
        };
      }
      console.warn(
        'Retrying a coach response that failed evidence validation',
        { reason: error.message },
      );
    } finally {
      options.timer?.end('validate');
    }
  }
  telemetry.validationOutcome = 'unverified';
  return {
    content: `${lastDraft}\n\n*Some figures in this answer could not be verified against your synchronized Hevy log.*`,
    model,
    coachId,
    telemetry,
  };
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
  const payload = await requestCompletion(
    {
      model,
      temperature: 0.2,
      max_tokens: 5000,
      reasoning: { effort: 'low' },
      response_format: { type: 'json_object' },
      provider: { data_collection: 'deny', allow_fallbacks: true },
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
    60_000,
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
  const payload = await requestCompletion(
    {
      model,
      temperature: 0.15,
      max_tokens: 5000,
      reasoning: { effort: 'low' },
      response_format: { type: 'json_object' },
      provider: { data_collection: 'deny', allow_fallbacks: true },
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
    60_000,
  );
  if (!payload) return null;
  const content = messageContent(payload);
  if (!content)
    throw new Error('OpenRouter returned an empty adjusted program');
  return extractJson(content);
}
