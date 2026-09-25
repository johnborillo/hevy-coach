import { getDashboardData } from '@/lib/hevy';
import { askCoach } from '@/lib/openrouter';
import { requestUserId } from '@/lib/request-user';
import {
  getProfile,
  listConversations,
  listMessages,
  saveMessage,
} from '@/lib/storage';
import {
  DEFAULT_COACH_ID,
  DEFAULT_COACH_MODEL,
  isCoachId,
  isCoachModelId,
} from '@/lib/coach-options';
import {
  createCoachAskTelemetry,
  type CoachAskTelemetry,
} from '@/lib/openrouter';
import { TurnTimer } from '@/lib/coach-telemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get(
    'conversationId',
  );
  if (!conversationId)
    return Response.json(
      { error: 'Conversation id is required.' },
      { status: 400 },
    );
  try {
    const userId = requestUserId(request.headers);
    const allowed = (await listConversations(userId)).some(
      (item) => item.id === conversationId,
    );
    if (!allowed)
      return Response.json({ error: 'Chat not found.' }, { status: 404 });
    return Response.json({
      messages: await listMessages(userId, conversationId),
    });
  } catch {
    return Response.json(
      { error: 'Messages are temporarily unavailable.' },
      { status: 503 },
    );
  }
}

function fallbackAnswer(
  question: string,
  dashboard: Awaited<ReturnType<typeof getDashboardData>>,
) {
  const prompt = question.toLowerCase();
  const reviewPointer =
    'Open the Weekly Review card on Today for the full evidence-backed wins, watch items, and next actions.';
  if (
    prompt.includes('break') ||
    prompt.includes('return') ||
    prompt.includes('hiatus')
  )
    return dashboard.insights.return;
  if (prompt.includes('plateau') || prompt.includes('stuck'))
    return dashboard.insights.plateau;
  if (prompt.includes('progress') || prompt.includes('next')) {
    if (dashboard.trend.change === 0) {
      return `Your verified Hevy history shows ${dashboard.stats.sessions30d} sessions in the last 30 days and ${dashboard.stats.workingSets7d} working sets in the last seven. ${dashboard.trend.exercise} is currently flat rather than clearly progressing, so treat it as a baseline: keep the load stable, improve repeatable reps or technique, and reassess after two or three comparable sessions.`;
    }
    return dashboard.insights.progress;
  }
  if (prompt.includes('week') || prompt.includes('review')) {
    return reviewPointer;
  }
  return `I can ground a plan in your Hevy history. Your latest session was ${dashboard.lastWorkout}; you logged ${dashboard.stats.workingSets7d} working sets in the last seven days. Ask about a plateau, a return plan, weekly feedback, or the next session. ${reviewPointer}`;
}

export async function POST(request: Request) {
  const timer = new TurnTimer();
  let shouldLogTelemetry = false;
  let telemetryLogged = false;
  let requestedModel = DEFAULT_COACH_MODEL;
  let servedModel: string | null = null;
  let coachId = DEFAULT_COACH_ID;
  let askTelemetry = createCoachAskTelemetry();
  const logTurn = () => {
    if (!shouldLogTelemetry || telemetryLogged) return;
    telemetryLogged = true;
    const timing = timer.serialize();
    console.info('coach.turn', {
      requestedModel,
      servedModel,
      coachId,
      passes: askTelemetry.passes,
      phases: timing.phases,
      totalMs: timing.totalMs,
      completions: askTelemetry.completions,
      validationOutcome: askTelemetry.validationOutcome,
      validationFailureReasons: askTelemetry.validationFailureReasons,
      refusalDetected: false,
      finalOutcome:
        servedModel === 'evidence-engine' ? 'evidence-engine' : 'ai',
    });
  };
  try {
    const body = (await request.json()) as {
      conversationId?: string;
      message?: string;
      model?: unknown;
      coachId?: unknown;
    };
    const conversationId = String(body.conversationId || '');
    const content = String(body.message || '')
      .trim()
      .slice(0, 4000);
    if (!conversationId || !content)
      return Response.json(
        { error: 'A chat and message are required.' },
        { status: 400 },
      );
    shouldLogTelemetry = true;
    if (body.model !== undefined && !isCoachModelId(body.model)) {
      return Response.json(
        { error: 'Choose a supported coach model.' },
        { status: 400 },
      );
    }
    if (body.coachId !== undefined && !isCoachId(body.coachId)) {
      return Response.json(
        { error: 'Choose a supported coach.' },
        { status: 400 },
      );
    }
    coachId = isCoachId(body.coachId) ? body.coachId : DEFAULT_COACH_ID;
    requestedModel = isCoachModelId(body.model)
      ? body.model
      : DEFAULT_COACH_MODEL;
    const userId = requestUserId(request.headers);
    timer.start('authz');
    let allowed = false;
    try {
      allowed = (await listConversations(userId)).some(
        (item) => item.id === conversationId,
      );
    } finally {
      timer.end('authz');
    }
    if (!allowed)
      return Response.json({ error: 'Chat not found.' }, { status: 404 });
    timer.start('saveUser');
    let userMessage;
    try {
      userMessage = await saveMessage(userId, conversationId, 'user', content);
    } finally {
      timer.end('saveUser');
    }
    timer.start('loadData');
    let profile;
    let dashboard;
    let history;
    try {
      [profile, dashboard, history] = await Promise.all([
        getProfile(userId),
        getDashboardData(userId),
        listMessages(userId, conversationId),
      ]);
    } finally {
      timer.end('loadData');
    }
    let answer: {
      content: string;
      model: string;
      coachId: typeof coachId;
      fallbackReason?: string | null;
      telemetry?: CoachAskTelemetry;
    };
    try {
      answer = (await askCoach(userId, profile, dashboard, history, {
        model: isCoachModelId(body.model) ? body.model : undefined,
        coachId,
        timer,
        telemetry: askTelemetry,
      })) ?? {
        content: fallbackAnswer(content, dashboard),
        model: 'evidence-engine',
        coachId,
        fallbackReason:
          'The OpenRouter API key is not configured for this deployment.',
      };
      askTelemetry = answer.telemetry ?? askTelemetry;
    } catch (error) {
      console.error('Coach AI failed after retrying', {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });
      answer = {
        content: fallbackAnswer(content, dashboard),
        model: 'evidence-engine',
        coachId,
        fallbackReason:
          error instanceof Error && error.message
            ? error.message.replace(/\s+/g, ' ').trim().slice(0, 600)
            : 'The AI provider did not return a usable response after retrying.',
      };
    }
    servedModel = answer.model;
    timer.start('saveAssistant');
    let assistantMessage;
    try {
      assistantMessage = await saveMessage(
        userId,
        conversationId,
        'assistant',
        answer.content,
        answer.model,
        answer.coachId,
        answer.fallbackReason,
      );
    } finally {
      timer.end('saveAssistant');
    }
    const response = Response.json({ userMessage, assistantMessage });
    response.headers.set('Server-Timing', timer.serverTiming());
    logTurn();
    return response;
  } catch {
    const response = Response.json(
      {
        error:
          'The coach could not answer right now. Your draft is still visible.',
      },
      { status: 503 },
    );
    response.headers.set('Server-Timing', timer.serverTiming());
    logTurn();
    return response;
  }
}
