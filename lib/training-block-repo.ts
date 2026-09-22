import { getDatabase } from '@/db';

export type TrainingBlockKind =
  | 'accumulation'
  | 'intensification'
  | 'deload'
  | 'maintenance'
  | 'custom';

export type TrainingBlock = {
  id: string;
  userId: string;
  name: string;
  kind: TrainingBlockKind;
  startsAt: string;
  endsAt: string | null;
  programId: string | null;
};

function isKind(value: string): value is TrainingBlockKind {
  return [
    'accumulation',
    'intensification',
    'deload',
    'maintenance',
    'custom',
  ].includes(value);
}

export async function listTrainingBlocks(userId: string) {
  const rows = await getDatabase()
    .prepare(
      `SELECT id, user_id, name, kind, starts_at, ends_at, program_id
       FROM training_blocks WHERE user_id = ? ORDER BY starts_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      user_id: string;
      name: string;
      kind: string;
      starts_at: string;
      ends_at: string | null;
      program_id: string | null;
    }>();
  return rows.results.map(
    (row) =>
      ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        kind: isKind(row.kind) ? row.kind : 'custom',
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        programId: row.program_id,
      }) satisfies TrainingBlock,
  );
}

export async function createTrainingBlock(
  userId: string,
  input: Omit<TrainingBlock, 'id' | 'userId'>,
) {
  const id = crypto.randomUUID();
  await getDatabase()
    .prepare(
      `INSERT INTO training_blocks (id, user_id, name, kind, starts_at, ends_at, program_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      input.name.trim(),
      input.kind,
      input.startsAt,
      input.endsAt,
      input.programId,
    )
    .run();
  return { id, userId, ...input } satisfies TrainingBlock;
}

export async function deleteTrainingBlock(userId: string, id: string) {
  await getDatabase()
    .prepare('DELETE FROM training_blocks WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .run();
}

export function activeTrainingBlock(blocks: TrainingBlock[], now = new Date()) {
  const time = now.getTime();
  return (
    blocks.find((block) => {
      const starts = new Date(block.startsAt).getTime();
      const ends = block.endsAt
        ? new Date(block.endsAt).getTime()
        : Number.POSITIVE_INFINITY;
      return starts <= time && time <= ends;
    }) ?? null
  );
}
