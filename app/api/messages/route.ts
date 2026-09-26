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
  type CoachMessageFlags,
} from '@/lib/coach-options';
import {
  createCoachAskTelemetry,
  type CoachAskTelemetry,
} from '@/lib/openrouter';
import { TurnTimer } from '@/lib/coach-telemetry';
import { searchStoredNotes } from '@/lib/notes-repo';

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

function sseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  payload: unknown,
) {
  try {
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
    );
  } catch {
    // A disconnected browser must not interrupt persistence or the upstream call.
  }
}

async function streamPost(request: Request) {
  const turnStartedAt = Date.now();
  const timer = new TurnTimer();
  const encoder = new TextEncoder();
  let body: {
    conversationId?: string;
    message?: string;
    model?: unknown;
    coachId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'A chat and message are required.' }, { status: 400 });
  }
  const conversationId = String(body.conversationId || '');
  const content = String(body.message || '').trim().slice(0, 4000);
  if (!conversationId || !content)
    return Response.json({ error: 'A chat and message are required.' }, { status: 400 });
  if (body.model !== undefined && !isCoachModelId(body.model))
    return Response.json({ error: 'Choose a supported coach model.' }, { status: 400 });
  if (body.coachId !== undefined && !isCoachId(body.coachId))
    return Response.json({ error: 'Choose a supported coach.' }, { status: 400 });
  const coachId = isCoachId(body.coachId) ? body.coachId : DEFAULT_COACH_ID;
  const requestedModel = isCoachModelId(body.model) ? body.model : DEFAULT_COACH_MODEL;
  const userId = requestUserId(request.headers);
  try {
    timer.start('loadData');
    timer.start('notes');
    const [conversations, profile, dashboard, noteResults] = await Promise.all([
      listConversations(userId),
      getProfile(userId),
      getDashboardData(userId),
      searchStoredNotes(userId, content),
    ]);
    timer.end('notes');
    timer.end('loadData');
    if (!conversations.some((item) => item.id === conversationId))
      return Response.json({ error: 'Chat not found.' }, { status: 404 });
    timer.start('saveUser');
    const userMessage = await saveMessage(userId, conversationId, 'user', content);
    timer.end('saveUser');
    const history = await listMessages(userId, conversationId);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sseEvent(controller, encoder, 'meta', { userMessage, requestedModel });
        void (async () => {
          let askTelemetry = createCoachAskTelemetry();
          let heldDelta = '';
          const pushDelta = (text: string) => {
            heldDelta += text;
            const marker = heldDelta.search(/\[NEED(?:\s*:\s*workout)?/i);
            if (marker >= 0) {
              const prefix = heldDelta.slice(0, marker);
              if (prefix) sseEvent(controller, encoder, 'delta', { text: prefix });
              const complete = heldDelta.match(/\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/i);
              heldDelta = complete
                ? heldDelta.slice(marker + complete[0].length)
                : heldDelta.slice(marker);
              return;
            }
            const safeLength = Math.max(0, heldDelta.length - 40);
            if (safeLength) {
              sseEvent(controller, encoder, 'delta', { text: heldDelta.slice(0, safeLength) });
              heldDelta = heldDelta.slice(safeLength);
            }
          };
          const flushDelta = () => {
            const text = heldDelta.replace(/\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/gi, '');
            if (text) sseEvent(controller, encoder, 'delta', { text });
            heldDelta = '';
          };
          try {
            const answer: {
              content: string;
              model: string;
              coachId: typeof coachId;
              fallbackReason?: string | null;
              flags?: CoachMessageFlags | null;
              telemetry?: CoachAskTelemetry;
            } = (await askCoach(
              userId,
              profile,
              dashboard,
              history,
              {
                model: isCoachModelId(body.model) ? body.model : undefined,
                coachId,
                timer,
                telemetry: askTelemetry,
                budgetStartedAt: turnStartedAt,
                stream: {
                  onDelta: pushDelta,
                  onStatus: (state) => sseEvent(controller, encoder, 'status', { state }),
                  onReset: () => {
                    heldDelta = '';
                    sseEvent(controller, encoder, 'reset', {});
                  },
                },
              },
              { noteResults },
            )) ?? {
              content: fallbackAnswer(content, dashboard),
              model: 'evidence-engine',
              coachId,
              fallbackReason:
                askTelemetry.fallbackReason ??
                'The OpenRouter API key is not configured for this deployment.',
              flags: askTelemetry.refusalDetected
                ? { v: 1 as const, refusal: true, requestedModel }
                : null,
            };
            flushDelta();
            askTelemetry = answer.telemetry ?? askTelemetry;
            timer.start('saveAssistant');
            const assistantMessage = await saveMessage(
              userId,
              conversationId,
              'assistant',
              answer.content,
              answer.model,
              answer.coachId,
              answer.fallbackReason,
              answer.flags,
            );
            timer.end('saveAssistant');
            sseEvent(controller, encoder, 'done', { assistantMessage });
          } catch (error) {
            sseEvent(controller, encoder, 'error', {
              error:
                error instanceof Error
                  ? error.message.replace(/\s+/g, ' ').trim().slice(0, 600)
                  : 'The coach could not answer right now.',
            });
          } finally {
            controller.close();
          }
        })();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Server-Timing': timer.serverTiming(),
      },
    });
  } catch {
    return Response.json({ error: 'The coach could not answer right now.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return streamPost(request);
  }
  const turnStartedAt = Date.now();
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
      issues: askTelemetry.issues,
      refusalDetected: askTelemetry.refusalDetected,
      refusalReason: askTelemetry.refusalReason,
      refusalRetries: askTelemetry.refusalRetries,
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
    timer.start('loadData');
    timer.start('notes');
    const authorizationPromise = listConversations(userId);
    const profilePromise = getProfile(userId);
    const dashboardPromise = getDashboardData(userId);
    const notesPromise = searchStoredNotes(userId, content);
    timer.start('authz');
    const [conversations, profile, dashboard, noteResults] = await Promise.all([
      authorizationPromise,
      profilePromise,
      dashboardPromise,
      notesPromise,
    ]);
    timer.end('authz');
    timer.end('notes');
    timer.end('loadData');
    const allowed = conversations.some((item) => item.id === conversationId);
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
    let history;
    try {
      history = await listMessages(userId, conversationId);
    } finally {
      timer.end('loadData');
    }
    let answer: {
      content: string;
      model: string;
      coachId: typeof coachId;
      fallbackReason?: string | null;
      flags?: CoachMessageFlags | null;
      telemetry?: CoachAskTelemetry;
    };
    try {
      answer = (await askCoach(userId, profile, dashboard, history, {
        model: isCoachModelId(body.model) ? body.model : undefined,
        coachId,
        timer,
        telemetry: askTelemetry,
        budgetStartedAt: turnStartedAt,
      }, {
        noteResults,
      })) ?? {
        content: fallbackAnswer(content, dashboard),
        model: 'evidence-engine',
        coachId,
        fallbackReason:
          askTelemetry.fallbackReason ??
          'The OpenRouter API key is not configured for this deployment.',
        flags: askTelemetry.refusalDetected
          ? {
              v: 1,
              refusal: true,
              requestedModel,
              ...(askTelemetry.passes > 0
                ? { passes: askTelemetry.passes }
                : {}),
            }
          : null,
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
        flags: null,
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
        answer.flags,
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
