import { requestUserId } from '@/lib/request-user';
import { listStoredTemplates } from '@/lib/hevy-repo';
import { isMuscle } from '@/lib/muscles';
import {
  createExerciseSlot,
  deleteExerciseSlot,
  listExerciseSlots,
  updateExerciseSlot,
} from '@/lib/slot-repo';
import { SLOT_PATTERNS, suggestSlots, type SlotPattern } from '@/lib/slots';
import { deserializeHevyTemplate } from '@/lib/hevy-store';
import { setExerciseSlot } from '@/lib/muscle-repo';

export const dynamic = 'force-dynamic';

function pattern(value: unknown): SlotPattern | null {
  return SLOT_PATTERNS.includes(value as SlotPattern)
    ? (value as SlotPattern)
    : null;
}

export async function GET(request: Request) {
  try {
    const userId = requestUserId(request.headers);
    const [slots, templates] = await Promise.all([
      listExerciseSlots(userId),
      listStoredTemplates(userId),
    ]);
    return Response.json({
      slots,
      suggestions: suggestSlots(templates.map(deserializeHevyTemplate)),
    });
  } catch (error) {
    console.error('Exercise slots could not be loaded', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'Exercise slots are unavailable.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      primaryMuscle?: unknown;
      pattern?: unknown;
      templateIds?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || !isMuscle(body.primaryMuscle)) {
      return Response.json(
        { error: 'Choose a name and valid primary muscle.' },
        { status: 400 },
      );
    }
    const userId = requestUserId(request.headers);
    const slot = await createExerciseSlot(userId, {
      name,
      primaryMuscle: body.primaryMuscle,
      pattern: pattern(body.pattern),
    });
    const templateIds = Array.isArray(body.templateIds)
      ? body.templateIds.filter((id): id is string => typeof id === 'string')
      : [];
    for (const templateId of templateIds) {
      await setExerciseSlot(userId, templateId, slot.id);
    }
    return Response.json({ slot }, { status: 201 });
  } catch (error) {
    console.error('Exercise slot could not be created', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'Exercise slot could not be created.' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      slotId?: unknown;
      name?: unknown;
      templateId?: unknown;
      assigned?: unknown;
    };
    const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : '';
    if (!slotId)
      return Response.json({ error: 'Slot is required.' }, { status: 400 });
    const userId = requestUserId(request.headers);
    if (typeof body.name === 'string') {
      await updateExerciseSlot(userId, slotId, { name: body.name });
    }
    if (typeof body.templateId === 'string') {
      await setExerciseSlot(
        userId,
        body.templateId,
        body.assigned === false ? null : slotId,
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Exercise slot could not be updated', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'Exercise slot could not be updated.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { slotId?: unknown };
    const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : '';
    if (!slotId)
      return Response.json({ error: 'Slot is required.' }, { status: 400 });
    await deleteExerciseSlot(requestUserId(request.headers), slotId);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Exercise slot could not be deleted', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return Response.json(
      { error: 'Exercise slot could not be deleted.' },
      { status: 400 },
    );
  }
}
