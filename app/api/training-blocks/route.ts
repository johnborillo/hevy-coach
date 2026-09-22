import { requestUserId } from '@/lib/request-user';
import {
  activeTrainingBlock,
  createTrainingBlock,
  deleteTrainingBlock,
  listTrainingBlocks,
  type TrainingBlockKind,
} from '@/lib/training-block-repo';

export const dynamic = 'force-dynamic';

const KINDS: TrainingBlockKind[] = [
  'accumulation',
  'intensification',
  'deload',
  'maintenance',
  'custom',
];

export async function GET(request: Request) {
  try {
    const blocks = await listTrainingBlocks(requestUserId(request.headers));
    return Response.json({ blocks, active: activeTrainingBlock(blocks) });
  } catch {
    return Response.json(
      { error: 'Training blocks are unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      kind?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      programId?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const kind =
      typeof body.kind === 'string' &&
      KINDS.includes(body.kind as TrainingBlockKind)
        ? (body.kind as TrainingBlockKind)
        : null;
    const startsAt = typeof body.startsAt === 'string' ? body.startsAt : '';
    if (!name || !kind || !Number.isFinite(new Date(startsAt).getTime())) {
      return Response.json(
        { error: 'A name, block type, and start date are required.' },
        { status: 400 },
      );
    }
    const endsAt =
      typeof body.endsAt === 'string' &&
      Number.isFinite(new Date(body.endsAt).getTime())
        ? new Date(body.endsAt).toISOString()
        : null;
    const block = await createTrainingBlock(requestUserId(request.headers), {
      name,
      kind,
      startsAt: new Date(startsAt).toISOString(),
      endsAt,
      programId: typeof body.programId === 'string' ? body.programId : null,
    });
    return Response.json({ block }, { status: 201 });
  } catch {
    return Response.json(
      { error: 'Training block could not be saved.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id.trim()) {
      return Response.json({ error: 'Block id is required.' }, { status: 400 });
    }
    await deleteTrainingBlock(requestUserId(request.headers), body.id);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: 'Training block could not be deleted.' },
      { status: 400 },
    );
  }
}
