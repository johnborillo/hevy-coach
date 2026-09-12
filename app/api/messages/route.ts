import { getDashboardData } from '@/lib/hevy';
import { askCoach, EvidenceMismatchError } from '@/lib/openrouter';
import { requestUserId } from '@/lib/request-user';
import { getProfile, listConversations, listMessages, saveMessage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  if (!conversationId) return Response.json({ error: 'Conversation id is required.' }, { status: 400 });
  try {
    const userId = requestUserId(request.headers);
    const allowed = (await listConversations(userId)).some((item) => item.id === conversationId);
    if (!allowed) return Response.json({ error: 'Chat not found.' }, { status: 404 });
    return Response.json({ messages: await listMessages(userId, conversationId) });
  } catch {
    return Response.json({ error: 'Messages are temporarily unavailable.' }, { status: 503 });
  }
}

function fallbackAnswer(question: string, dashboard: Awaited<ReturnType<typeof getDashboardData>>) {
  const prompt = question.toLowerCase();
  if (prompt.includes('break') || prompt.includes('return') || prompt.includes('hiatus')) return dashboard.insights.return;
  if (prompt.includes('plateau') || prompt.includes('stuck')) return dashboard.insights.plateau;
  if (prompt.includes('progress') || prompt.includes('next')) return dashboard.insights.progress;
  if (prompt.includes('week') || prompt.includes('review')) {
    return `This week: ${dashboard.weeklyReview.wins.join(' ')} Watch: ${dashboard.weeklyReview.watch.join(' ')} Next: ${dashboard.weeklyReview.nextSteps.join(' ')}`;
  }
  return `I can ground a plan in your Hevy history. Your latest session was ${dashboard.lastWorkout}; you logged ${dashboard.stats.workingSets7d} working sets in the last seven days. Ask about a plateau, a return plan, weekly feedback, or the next session.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { conversationId?: string; message?: string };
    const conversationId = String(body.conversationId || '');
    const content = String(body.message || '').trim().slice(0, 4000);
    if (!conversationId || !content) return Response.json({ error: 'A chat and message are required.' }, { status: 400 });
    const userId = requestUserId(request.headers);
    const allowed = (await listConversations(userId)).some((item) => item.id === conversationId);
    if (!allowed) return Response.json({ error: 'Chat not found.' }, { status: 404 });
    const userMessage = await saveMessage(userId, conversationId, 'user', content);
    const [profile, dashboard, history] = await Promise.all([
      getProfile(userId),
      getDashboardData(),
      listMessages(userId, conversationId),
    ]);
    let answer: { content: string; model: string };
    try {
      answer = (await askCoach(profile, dashboard, history)) ?? {
        content: fallbackAnswer(content, dashboard),
        model: 'evidence-engine',
      };
    } catch (error) {
      console.error('Coach AI failed after retrying', {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });
      const evidenceMismatch = error instanceof EvidenceMismatchError;
      answer = {
        content: `${fallbackAnswer(content, dashboard)}\n\n*The AI draft was withheld because it referenced workout evidence that could not be matched to your synchronized Hevy log. This answer uses only the verified training signals above.*`,
        model: 'evidence-engine',
      };
      if (!evidenceMismatch) {
        answer.content = `${fallbackAnswer(content, dashboard)}\n\n*The AI provider was unavailable after retrying, so this answer uses only the verified training signals calculated from your Hevy history.*`;
      }
    }
    const assistantMessage = await saveMessage(userId, conversationId, 'assistant', answer.content, answer.model);
    return Response.json({ userMessage, assistantMessage });
  } catch {
    return Response.json({ error: 'The coach could not answer right now. Your draft is still visible.' }, { status: 503 });
  }
}
