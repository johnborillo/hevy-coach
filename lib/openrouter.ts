import type { DashboardData } from '@/lib/hevy';
import type {
  AthleteProfile,
  ChatMessage,
  TrainingProgram,
} from '@/lib/storage';

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
- Cite concrete evidence inline as [Hevy: workout/date/lift] or [Profile: field] whenever it supports a recommendation.
- Never invent logged sets, injuries, diagnoses, or personal details.
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
  choices?: Array<{ message?: { content?: string } }>;
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

      if (response.ok) return (await response.json()) as CompletionPayload;

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
  const candidate =
    fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  return JSON.parse(candidate) as Omit<TrainingProgram, 'id' | 'createdAt'>;
}

function compactContext(profile: AthleteProfile, dashboard: DashboardData) {
  return JSON.stringify({
    athlete: profile,
    hevy: {
      source: dashboard.sourceLabel,
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

export async function askCoach(
  profile: AthleteProfile,
  dashboard: DashboardData,
  history: ChatMessage[],
) {
  const model =
    process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
  const messages: OpenRouterMessage[] = [
    { role: 'system', content: COACH_PERSONA },
    {
      role: 'system',
      content: `Current private training context:\n${compactContext(profile, dashboard)}`,
    },
    ...history.slice(-18).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const payload = await requestCompletion(
    {
      model,
      messages,
      temperature: 0.35,
      max_tokens: 1000,
      provider: { data_collection: 'deny', allow_fallbacks: true },
    },
    45_000,
  );
  if (!payload) return null;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenRouter returned an empty response');
  return { content, model: payload.model ?? model };
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
  const model =
    process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
  const payload = await requestCompletion(
    {
      model,
      temperature: 0.2,
      max_tokens: 2200,
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
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty program');
  return extractJson(content);
}
