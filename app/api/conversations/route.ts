import { createConversation, deleteConversation, listConversations } from '@/lib/storage';
import { requestUserId } from '@/lib/request-user';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return Response.json({ conversations: await listConversations(requestUserId(request.headers)) });
  } catch {
    return Response.json({ error: 'Conversation history is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const conversation = await createConversation(requestUserId(request.headers), String(body.title || 'New coaching chat').slice(0, 80));
    return Response.json({ conversation }, { status: 201 });
  } catch {
    return Response.json({ error: 'A new chat could not be created.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Conversation id is required.' }, { status: 400 });
  try {
    await deleteConversation(requestUserId(request.headers), id);
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: 'The chat could not be deleted.' }, { status: 503 });
  }
}
