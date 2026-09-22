import type { ExerciseTemplate, HevyExercise, HevySet, HevyWorkout } from './hevy-types';
import { classifySet, type ClassifiedSet } from './sets';
import type { MuscleOverride } from './muscles';
import type { ExerciseSlot } from './slots';

export type RecordKind = 'e1rm' | 'load_at_reps' | 'reps_at_load';

export type PersonalRecord = {
  id: string;
  key: string;
  scope: 'template' | 'slot';
  templateId: string;
  slotId: string | null;
  subjectKey: string;
  exercise: string;
  kind: RecordKind;
  repBucket: string | null;
  value: number;
  reps: number;
  loadKg: number;
  performedAt: string;
  workoutId: string;
  previousValue: number | null;
  previousAt: string | null;
};

type SubjectSession = {
  templateId: string;
  title: string;
  slotId: string | null;
  scope: 'template' | 'slot';
  sets: ClassifiedSet[];
};

type Candidate = {
  kind: RecordKind;
  repBucket: string | null;
  value: number;
  reps: number;
  loadKg: number;
};

const RECORD_KINDS: Record<RecordKind, number> = {
  e1rm: 0,
  load_at_reps: 1,
  reps_at_load: 2,
};

function repBucket(reps: number) {
  if (reps <= 3) return '1-3';
  if (reps <= 6) return '4-6';
  if (reps <= 9) return '7-9';
  if (reps <= 12) return '10-12';
  return '13+';
}

function modalLoad(sets: ClassifiedSet[]) {
  const counts = new Map<number, number>();
  for (const set of sets) {
    if (set.loadKg == null || set.loadKg <= 0 || set.reps == null) continue;
    const rounded = Math.round(set.loadKg * 4) / 4;
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .at(0)?.[0] ?? null;
}

function candidateRecords(session: SubjectSession): Candidate[] {
  const working = session.sets.filter((set) => set.countsAsWorking > 0);
  const candidates: Candidate[] = [];
  const bestE1rm = working
    .filter((set) => set.e1rmEligible && set.e1rmKg != null && set.loadKg != null)
    .sort((a, b) => (b.e1rmKg ?? 0) - (a.e1rmKg ?? 0))[0];
  if (bestE1rm?.e1rmKg != null && bestE1rm.loadKg != null) {
    candidates.push({
      kind: 'e1rm',
      repBucket: null,
      value: bestE1rm.e1rmKg,
      reps: bestE1rm.reps ?? 0,
      loadKg: bestE1rm.loadKg,
    });
  }

  const bestByBucket = new Map<string, ClassifiedSet>();
  for (const set of working) {
    if (set.loadKg == null || set.loadKg <= 0 || set.reps == null || set.reps <= 0)
      continue;
    const bucket = repBucket(set.reps);
    const current = bestByBucket.get(bucket);
    if (
      !current ||
      set.loadKg > (current.loadKg ?? 0) ||
      (set.loadKg === current.loadKg && set.reps > (current.reps ?? 0))
    ) {
      bestByBucket.set(bucket, set);
    }
  }
  for (const [bucket, set] of bestByBucket) {
    if (set.loadKg == null || set.reps == null) continue;
    candidates.push({
      kind: 'load_at_reps',
      repBucket: bucket,
      value: set.loadKg,
      reps: set.reps,
      loadKg: set.loadKg,
    });
  }

  const load = modalLoad(working);
  if (load != null) {
    const reps = Math.max(
      ...working
        .filter((set) => set.loadKg != null && Math.abs(set.loadKg - load) < 0.26)
        .map((set) => set.reps ?? 0),
    );
    if (reps > 0) {
      candidates.push({
        kind: 'reps_at_load',
        repBucket: null,
        value: reps,
        reps,
        loadKg: load,
      });
    }
  }
  return candidates;
}

function subjectsFor(
  exercise: HevyExercise,
  slot: ExerciseSlot | null,
): Array<{ key: string; scope: 'template' | 'slot'; slotId: string | null; exercise: string }> {
  const templateSubject = {
    key: `template:${exercise.exercise_template_id}`,
    scope: 'template' as const,
    slotId: slot?.id ?? null,
    exercise: exercise.title,
  };
  if (!slot) return [templateSubject];
  return [
    templateSubject,
    {
      key: `slot:${slot.id}`,
      scope: 'slot' as const,
      slotId: slot.id,
      exercise: slot.name,
    },
  ];
}

function classify(
  exercise: HevyExercise,
  set: HevySet,
  template: ExerciseTemplate | undefined,
) {
  return classifySet(set, {
    title: exercise.title,
    equipment: template?.equipment,
    primary_muscle_group: template?.primary_muscle_group,
  });
}

export function detectRecords(
  workouts: HevyWorkout[],
  templates: ExerciseTemplate[],
  muscleOverrides: MuscleOverride[] = [],
  exerciseSlots: ExerciseSlot[] = [],
  options: { minimumPriorSessions?: number } = {},
) {
  const minimumPriorSessions = Math.max(
    0,
    Math.floor(options.minimumPriorSessions ?? 5),
  );
  const templateMap = new Map(templates.map((template) => [template.id, template]));
  const overrideMap = new Map(
    muscleOverrides.map((override) => [override.exerciseTemplateId, override]),
  );
  const slotMap = new Map(exerciseSlots.map((slot) => [slot.id, slot]));
  const ordered = [...workouts].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
  const bestByKey = new Map<string, { value: number; performedAt: string }>();
  const priorSessions = new Map<string, number>();
  const records: PersonalRecord[] = [];

  for (const workout of ordered) {
    const sessions = new Map<string, SubjectSession>();
    for (const exercise of workout.exercises) {
      const slotId = overrideMap.get(exercise.exercise_template_id)?.slotId ?? null;
      const slot = slotId ? (slotMap.get(slotId) ?? null) : null;
      const classified = exercise.sets.map((set) =>
        classify(exercise, set, templateMap.get(exercise.exercise_template_id)),
      );
      for (const subject of subjectsFor(exercise, slot)) {
        const current = sessions.get(subject.key) ?? {
          templateId: exercise.exercise_template_id,
          title: subject.exercise,
          slotId: subject.slotId,
          scope: subject.scope,
          sets: [],
        };
        current.sets.push(...classified);
        sessions.set(subject.key, current);
      }
    }

    for (const [subjectKey, session] of sessions) {
      const working = session.sets.some((set) => set.countsAsWorking > 0);
      if (!working) continue;
      const sessionCount = priorSessions.get(subjectKey) ?? 0;
      for (const candidate of candidateRecords(session)) {
        const key = `${subjectKey}:${candidate.kind}:${candidate.repBucket ?? 'all'}`;
        const previous = bestByKey.get(key);
        if (previous && sessionCount >= minimumPriorSessions && candidate.value > previous.value) {
          records.push({
            id: `${key}:${workout.id}:${workout.start_time}`,
            key,
            scope: session.scope,
            templateId: session.templateId,
            slotId: session.slotId,
            subjectKey,
            exercise: session.title,
            kind: candidate.kind,
            repBucket: candidate.repBucket,
            value: Math.round(candidate.value * 100) / 100,
            reps: candidate.reps,
            loadKg: Math.round(candidate.loadKg * 100) / 100,
            performedAt: workout.start_time,
            workoutId: workout.id,
            previousValue: Math.round(previous.value * 100) / 100,
            previousAt: previous.performedAt,
          });
        }
        if (!previous || candidate.value > previous.value) {
          bestByKey.set(key, {
            value: candidate.value,
            performedAt: workout.start_time,
          });
        }
      }
      priorSessions.set(subjectKey, sessionCount + 1);
    }
  }

  return records.sort(
    (a, b) =>
      new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime() ||
      (a.scope === 'slot' ? -1 : 1) - (b.scope === 'slot' ? -1 : 1) ||
      RECORD_KINDS[a.kind] - RECORD_KINDS[b.kind],
  );
}

export function selectRecentRecords(
  records: PersonalRecord[],
  now = new Date(),
  options: { days?: number; limit?: number } = {},
) {
  const days = options.days ?? 30;
  const cutoff = now.getTime() - days * 86_400_000;
  const recent = records.filter((record) => {
    const time = new Date(record.performedAt).getTime();
    return time >= cutoff && time <= now.getTime();
  });
  const slotKeys = new Set(
    recent
      .filter((record) => record.scope === 'slot')
      .map((record) => `${record.slotId}:${record.kind}:${record.repBucket ?? 'all'}`),
  );
  const seen = new Set<string>();
  return recent
    .filter((record) => {
      const slotKey = `${record.slotId}:${record.kind}:${record.repBucket ?? 'all'}`;
      if (record.scope === 'template' && record.slotId && slotKeys.has(slotKey)) {
        return false;
      }
      const subjectKey = `${record.scope}:${record.subjectKey}`;
      if (seen.has(subjectKey)) return false;
      seen.add(subjectKey);
      return true;
    })
    .slice(0, options.limit ?? 5);
}
