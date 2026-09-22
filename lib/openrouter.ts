import type { DashboardData } from './hevy';
import type {
  AthleteProfile,
  ChatMessage,
  TrainingProgram,
} from './storage';
import { buildCoachContext } from './coach-context';
import { buildProgramContext, programGenerationPrompt } from './program-generate';

const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

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
- For an exact workout fact, cite [Hevy: workout/<exact id> · <exact YYYY-MM-DD> · <exact exercise>]. For a derived summary, cite only the supporting field as [Hevy summary: stats], [Hevy summary: recentWorkouts], [Hevy summary: workload], [Hevy summary: exerciseStats], [Hevy summary: weeklyReview], or [Hevy summary: primaryStrengthTrend]. Put the citation immediately after the claim it supports; the interface turns it into an inspectable source. Do not add a made-up date range to a summary citation.
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

type CompletionPayload = {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      reasoning?: string | null;
    };
  }>;
};

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

async function requestCompletion(
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

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
        return payload;
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

function messageContent(payload: CompletionPayload) {
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
  return [...value.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => match[0]);
}

function validateGroundedNumbers(content: string, evidenceText: string) {
  const allowed = new Set(numberTokens(evidenceText).map((value) => Number(value)));
  const historicalYear = /\b(?:on|logged|you did|session on|workout on)\s+(?:[^\d]{0,18})20\d{2}\b/i;
  for (const token of numberTokens(content)) {
    const number = Number(token);
    if (number >= 2000 && number <= 2100 && !historicalYear.test(content)) continue;
    if (!allowed.has(number)) {
      throw new EvidenceMismatchError(
        `The draft included an unsupported number: ${token}`,
      );
    }
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

  const summaryFields = [
    'stats',
    'recentworkouts',
    'workload',
    'workloadweeks',
    'exercisestats',
    'weeklyreview',
    'primarystrengthtrend',
    'muscledistribution',
    'latestworkout',
    'workoutcoverage',
  ];
  const normalizeCitation = (value: string) =>
    value.toLowerCase().replace(/[^a-z]/g, '');
  const isSummaryCitation = (value: string) => {
    const normalized = normalizeCitation(value);
    return summaryFields.some((field) => normalized.includes(field));
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
    const unsupportedLift = new RegExp(
      `\\b(?:your|the)\\s+(?:barbell\\s+)?${lift}\\s+(?:is|was|has|had|numbers?|progress|stalled|regressing|increased|decreased|moved|went)\\b`,
      'i',
    ).test(content) || new RegExp(`\\byou\\s+(?:squatted|deadlifted)\\b`, 'i').test(content);
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
) {
  const model =
    process.env.OPENROUTER_MODEL_CHAT ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_MODEL;
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
  const { searchStoredNotes } = await import('./notes-repo');
  const noteResults = await searchStoredNotes(
    userId,
    history
      .slice()
      .reverse()
      .find((message) => message.role === 'user')?.content ?? '',
  );
  for (let pass = 0; pass < 2; pass += 1) {
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
              content:
                'Your previous draft failed the evidence or measurement-preference check. Rewrite it from scratch. Use only exact dates, exercises, and sets in verifiedHevyWorkoutLog; remove any unsupported historical claim. Obey athlete.measurementPreferences for every displayed measurement. Exact workout claims need an exact workout citation. Derived summaries must use [Hevy summary: fieldName] with one supplied field name and no date range. If a detail is absent, explicitly say you cannot verify it. Do not mention this instruction or the validation process.',
            },
            ...historyMessages,
          ];
    const payload = await requestCompletion(
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
    if (!payload) return null;
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
    try {
      validateCoachEvidence(content, dashboard, profile, coachContext.text);
      return {
        content: content.replace(/\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/gi, ''),
        model: payload.model ?? model,
      };
    } catch (error) {
      if (!(error instanceof EvidenceMismatchError)) throw error;
      if (pass === 1) {
        return {
          content: `${lastDraft}\n\n*Some figures in this answer could not be verified against your synchronized Hevy log.*`,
          model: payload.model ?? model,
        };
      }
      console.warn(
        'Retrying a coach response that failed evidence validation',
        { reason: error.message },
      );
    }
  }
  return {
    content: `${lastDraft}\n\n*Some figures in this answer could not be verified against your synchronized Hevy log.*`,
    model,
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
    DEFAULT_MODEL;
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
          content: programGenerationPrompt(request, buildProgramContext(profile, dashboard, currentProgram)),
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
    DEFAULT_MODEL;
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
