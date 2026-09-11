import type { DashboardData } from '@/lib/hevy';
import type { AthleteProfile, ChatMessage, TrainingProgram } from '@/lib/storage';

const COACH_PERSONA = `You are Rowan, a highly experienced strength and physique coach who has trained recreational lifters and competitive athletes for more than 15 years. You are direct, calm, practical, and evidence-led. You care about adherence, progressive overload, fatigue management, technique quality, and the athlete's actual constraints.

Rules:
- Ground recommendations in the supplied Hevy history and athlete profile. Distinguish observed facts from reasonable hypotheses.
- Cite concrete evidence inline as [Hevy: workout/date/lift] or [Profile: field] whenever it supports a recommendation.
- Never invent logged sets, injuries, diagnoses, or personal details.
- When data is insufficient, say what is missing and give a conservative next step.
- Prefer concise action plans with loads, reps, RIR/RPE, rest, and progression criteria when useful.
- Treat estimated 1RM as a trend signal, not a true max.
- Do not diagnose pain or medical conditions. Recommend qualified care for persistent or concerning symptoms.
- Never claim a workout or routine was written to Hevy. Drafts require athlete approval.`;

type OpenRouterMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
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
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
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

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Hevy Coach',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      max_tokens: 1000,
      provider: { data_collection: 'deny', allow_fallbacks: true },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenRouter returned an empty response');
  return { content, model: payload.model ?? model };
}

export async function generateProgramWithCoach(
  profile: AthleteProfile,
  dashboard: DashboardData,
  request: { goal: string; durationWeeks: number; daysPerWeek: number; minutesPerSession: number },
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Hevy Coach',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2200,
      provider: { data_collection: 'deny', allow_fallbacks: true },
      messages: [
        { role: 'system', content: COACH_PERSONA },
        {
          role: 'user',
          content: `Create a ${request.durationWeeks}-week program for ${request.goal}, ${request.daysPerWeek} days per week, ${request.minutesPerSession} minutes per session. Use the supplied athlete constraints and prioritize familiar Hevy exercises when sensible. Return JSON only with: title, overview, progression, deload, and days. Each day needs day, title, focus, and exercises. Each exercise needs name, sets (number), reps (string), effort, restSeconds (number), and note.\n\n${compactContext(profile, dashboard)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty program');
  return extractJson(content);
}
