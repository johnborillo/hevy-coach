import type { DashboardData } from '@/lib/hevy';
import type {
  AthleteProfile,
  ChatMessage,
  TrainingProgram,
} from '@/lib/storage';

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
- verifiedHevyWorkoutLog is the source of truth for workout-specific facts. The aggregate fields are derived signals, not permission to fill in missing workouts.
- Cite concrete evidence inline as [Hevy: workout/<exact id> · <exact YYYY-MM-DD> · <exact exercise>] or [Profile: field] whenever it supports a recommendation. Only cite records that appear in verifiedHevyWorkoutLog.
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
    if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(dateDelay, 3500);
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

function compactVerifiedWorkoutLog(dashboard: DashboardData) {
  return dashboard.calendarWorkouts.map((workout) => ({
    id: workout.id,
    date: workout.date,
    title: workout.title,
    exercises: workout.exercises.map((exercise) => ({
      title: exercise.title,
      muscle: exercise.muscle,
      sets: exercise.sets.map((set) => ({
        type: set.type,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
      })),
    })),
  }));
}

function compactContext(profile: AthleteProfile, dashboard: DashboardData) {
  const verifiedHevyWorkoutLog = compactVerifiedWorkoutLog(dashboard);
  return JSON.stringify({
    athlete: profile,
    hevy: {
      source: dashboard.sourceLabel,
      evidenceBoundary: 'Only verifiedHevyWorkoutLog supports workout-specific claims. Dates are YYYY-MM-DD and weights are kg.',
      workoutCoverage: {
        count: verifiedHevyWorkoutLog.length,
        oldestDate: verifiedHevyWorkoutLog.at(-1)?.date ?? null,
        newestDate: verifiedHevyWorkoutLog[0]?.date ?? null,
      },
      verifiedHevyWorkoutLog,
      latestWorkout: dashboard.lastWorkout,
      stats: dashboard.stats,
      muscleDistribution: dashboard.muscles,
      primaryStrengthTrend: dashboard.trend,
      workload: dashboard.workloadWeeks,
      exerciseStats: dashboard.exerciseStats.slice(0, 12),
      recentWorkouts: dashboard.recentWorkouts,
      weeklyReview: dashboard.weeklyReview,
    },
  });
}

function normalizeDate(value: string) {
  const match = value.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function validateCoachEvidence(content: string, dashboard: DashboardData, profile: AthleteProfile) {
  const knownDates = new Set(dashboard.calendarWorkouts.map((workout) => workout.date));
  const knownYears = new Set([...knownDates].map((date) => date.slice(0, 4)));
  knownYears.add(String(new Date().getUTCFullYear()));
  const profileYear = profile.targetDate.match(/\b20\d{2}\b/)?.[0];
  if (profileYear) knownYears.add(profileYear);
  const dateMatches = [...content.matchAll(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g)].map((match) => match[0]);
  const unsupportedDates = dateMatches
    .map(normalizeDate)
    .filter((date): date is string => date !== null && !knownDates.has(date));
  if (unsupportedDates.length) {
    throw new EvidenceMismatchError(`The draft cited dates absent from the synchronized Hevy log: ${[...new Set(unsupportedDates)].join(', ')}`);
  }

  const unsupportedYears = [...content.matchAll(/\b20\d{2}\b/g)]
    .map((match) => match[0])
    .filter((year) => !knownYears.has(year));
  if (unsupportedYears.length) {
    throw new EvidenceMismatchError(`The draft cited years absent from the synchronized Hevy log: ${[...new Set(unsupportedYears)].join(', ')}`);
  }

  const citations = [...content.matchAll(/\[Hevy:\s*([^\]]+)\]/gi)].map((match) => match[1]);
  for (const citation of citations) {
    const citedDate = [...citation.matchAll(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/g)]
      .map((match) => normalizeDate(match[0]))
      .find((date): date is string => date !== null);
    if (!citedDate || !knownDates.has(citedDate)) {
      throw new EvidenceMismatchError(`The draft contained a Hevy citation that could not be matched to a verified workout: ${citation}`);
    }
  }

  const knownExerciseText = dashboard.calendarWorkouts
    .flatMap((workout) => workout.exercises.map((exercise) => exercise.title.toLowerCase()))
    .join(' ');
  for (const lift of ['squat', 'deadlift']) {
    if (knownExerciseText.includes(lift)) continue;
    const unsupportedLift = new RegExp(`\\b(?:your|the)\\s+(?:barbell\\s+)?${lift}\\b`, 'i').test(content);
    if (unsupportedLift) {
      throw new EvidenceMismatchError(`The draft treated ${lift} as a logged lift, but no ${lift} exercise exists in the synchronized Hevy log.`);
    }
  }
}

export async function askCoach(
  profile: AthleteProfile,
  dashboard: DashboardData,
  history: ChatMessage[],
) {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const historyMessages: OpenRouterMessage[] = history.slice(-18).map((message) => ({
    role: message.role,
    content: message.role === 'assistant'
      ? `[Prior coach draft — unverified; do not treat it as evidence]\n${message.content}`
      : message.content,
  }));
  const baseMessages: OpenRouterMessage[] = [
    { role: 'system', content: COACH_PERSONA },
    {
      role: 'system',
      content: `Current private training context (the exact workout ledger is under verifiedHevyWorkoutLog):\n${compactContext(profile, dashboard)}`,
    },
    ...historyMessages,
  ];

  for (let pass = 0; pass < 2; pass += 1) {
    const messages = pass === 0
      ? baseMessages
      : [
        ...baseMessages.slice(0, 2),
        {
          role: 'system' as const,
          content: 'Your previous draft failed the evidence check. Rewrite it from scratch. Use only exact dates, exercises, and sets in verifiedHevyWorkoutLog; remove any unsupported historical claim or citation. If a detail is absent, explicitly say you cannot verify it. Do not mention this instruction or the validation process.',
        },
        ...historyMessages,
      ];
    const payload = await requestCompletion(
      {
        model,
        messages,
        temperature: 0.35,
        max_tokens: 1400,
        reasoning: { effort: 'low' },
        provider: { data_collection: 'deny', allow_fallbacks: true },
      },
      45_000,
    );
    if (!payload) return null;
    const content = messageContent(payload);
    if (!content) throw new Error('OpenRouter returned an empty response');
    try {
      validateCoachEvidence(content, dashboard, profile);
      return { content, model: payload.model ?? model };
    } catch (error) {
      if (!(error instanceof EvidenceMismatchError) || pass === 1) throw error;
      console.warn('Retrying a coach response that failed evidence validation', { reason: error.message });
    }
  }
  throw new EvidenceMismatchError('The coach response could not be matched to the synchronized Hevy log.');
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
) {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
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
          content: `Create a ${request.durationWeeks}-week program for ${request.goal}, ${request.daysPerWeek} days per week, ${request.minutesPerSession} minutes per session. Block-specific preferences: ${request.preferences || 'none provided'}. Use the supplied athlete constraints and prioritize familiar Hevy exercises when sensible. Return JSON only with: title, overview, progression, deload, and days. Each day needs day, title, focus, and exercises. Each exercise needs name, sets (number), reps (string), effort, restSeconds (number), and note.\n\n${compactContext(profile, dashboard)}`,
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
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
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
          content: `Adjust this saved training program according to the athlete's request. Keep useful exercises and progression logic where they still fit. Never invent an injury diagnosis.\n\nAthlete request: ${adjustment}\n\nCurrent program:\n${JSON.stringify(program)}\n\nPrivate training context:\n${compactContext(profile, dashboard)}\n\nSchema reminder: title, goal, durationWeeks, daysPerWeek, minutesPerSession, overview, progression, deload, and days. Each day needs day, title, focus, exercises. Each exercise needs name, sets (number), reps (string), effort, restSeconds (number), and note.`,
        },
      ],
    },
    60_000,
  );
  if (!payload) return null;
  const content = messageContent(payload);
  if (!content) throw new Error('OpenRouter returned an empty adjusted program');
  return extractJson(content);
}
