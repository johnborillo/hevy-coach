import type { DashboardData } from './hevy';
import type {
  AthleteProfile,
  ProgramEffort,
  ProgramExercise,
  ProgramProgression,
  TrainingProgram,
} from './storage';

export type ProgramMetadata = Pick<
  TrainingProgram,
  'goal' | 'durationWeeks' | 'daysPerWeek' | 'minutesPerSession'
>;

type CandidateExercise = Record<string, unknown>;

const DEFAULT_REP_RANGE: [number, number] = [8, 12];
const DEFAULT_EFFORT: ProgramEffort = { type: 'rir', value: [2, 3] };

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length >= 3);
}

function normalizeName(value: string) {
  return words(value).join(' ');
}

export function parseRepRange(value: unknown): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const lower = number(value[0]);
    const upper = number(value[1]);
    if (lower !== null && upper !== null) {
      return [Math.max(1, Math.round(Math.min(lower, upper))), Math.max(1, Math.round(Math.max(lower, upper)))];
    }
  }
  const source = typeof value === 'number' ? String(value) : text(value);
  const matches = [...source.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (!matches.length) return DEFAULT_REP_RANGE;
  const lower = Math.max(1, Math.round(matches[0]));
  const upper = Math.max(lower, Math.round(matches[1] ?? lower));
  return [lower, upper];
}

function normalizeEffortValue(
  type: ProgramEffort['type'],
  value: unknown,
): ProgramEffort['value'] {
  if (Array.isArray(value) && value.length >= 2) {
    const lower = number(value[0]);
    const upper = number(value[1]);
    if (lower !== null && upper !== null) {
      const min = type === 'rpe' ? 1 : 0;
      const max = type === 'rpe' ? 10 : 6;
      return [
        Math.min(max, Math.max(min, Math.round(lower * 2) / 2)),
        Math.min(max, Math.max(min, Math.round(upper * 2) / 2)),
      ];
    }
  }
  const single = number(value);
  if (single !== null) {
    const min = type === 'rpe' ? 1 : 0;
    const max = type === 'rpe' ? 10 : 6;
    return Math.min(max, Math.max(min, Math.round(single * 2) / 2));
  }
  return DEFAULT_EFFORT.value;
}

export function parseEffort(value: unknown): ProgramEffort {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as { type?: unknown; value?: unknown };
    const type = candidate.type === 'rpe' ? 'rpe' : candidate.type === 'rir' ? 'rir' : null;
    if (type) return { type, value: normalizeEffortValue(type, candidate.value) };
  }
  const source = text(value).toLowerCase();
  const type: ProgramEffort['type'] = source.includes('rpe') ? 'rpe' : 'rir';
  return { type, value: normalizeEffortValue(type, source) };
}

export function formatRepRange(range: [number, number]) {
  return range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}`;
}

export function formatEffort(effort: ProgramEffort) {
  const label = effort.type.toUpperCase();
  return Array.isArray(effort.value)
    ? `${effort.value[0]}–${effort.value[1]} ${label}`
    : `${effort.value} ${label}`;
}

function equipmentForExercise(name: string): keyof AthleteProfile['loadIncrements'] {
  const lower = name.toLowerCase();
  if (/cable|pulldown|pushdown|crossover/.test(lower)) return 'cable';
  if (/machine|smith|hack|leg press/.test(lower)) return 'machine';
  if (/dumbbell|kettlebell/.test(lower)) return 'dumbbell';
  return 'barbell';
}

function findReference(name: string, dashboard?: DashboardData) {
  const stats = dashboard?.exerciseStats ?? [];
  const normalized = normalizeName(name);
  const exact = stats.find((item) => normalizeName(item.exercise) === normalized);
  if (exact) return exact;
  const candidateWords = new Set(words(name));
  return stats
    .map((item) => ({
      item,
      score: words(item.exercise).filter((word) => candidateWords.has(word)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
}

function progression(value: unknown, name: string, profile: AthleteProfile): ProgramProgression {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const allowed = new Set(['double_progression', 'linear_load', 'rep_target_then_load', 'hold']);
  const rule = allowed.has(String(source.rule))
    ? (String(source.rule) as ProgramProgression['rule'])
    : 'double_progression';
  const increment = number(source.loadIncrementKg);
  const trigger = number(source.triggerReps);
  return {
    rule,
    loadIncrementKg: Math.max(
      0,
      increment ?? profile.loadIncrements[equipmentForExercise(name)],
    ),
    ...(trigger !== null ? { triggerReps: Math.max(1, Math.round(trigger)) } : {}),
  };
}

function normalizeExercise(
  value: unknown,
  profile: AthleteProfile,
  dashboard?: DashboardData,
): ProgramExercise | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as CandidateExercise;
  const name = text(candidate.name);
  const sets = number(candidate.sets);
  if (!name || sets === null) return null;
  const reference = findReference(name, dashboard);
  const repRange = parseRepRange(candidate.repRange ?? candidate.reps);
  const effort = parseEffort(candidate.effort);
  const startingLoadKg = number(candidate.startingLoadKg) ?? reference?.modalLoadKg ?? null;
  const requestedTemplateId = text(candidate.exerciseTemplateId);
  const knownTemplateIds = new Set(
    (dashboard?.exerciseStats ?? []).map((item) => item.exerciseTemplateId),
  );
  const templateId =
    (requestedTemplateId && knownTemplateIds.has(requestedTemplateId)
      ? requestedTemplateId
      : null) ||
    reference?.exerciseTemplateId ||
    null;
  const slotId = text(candidate.slotId) || reference?.slotId || null;
  const note = text(candidate.note, 'Use a controlled effort and stop with clean reps.');
  return {
    exerciseTemplateId: templateId,
    slotId,
    name: name.slice(0, 120),
    sets: Math.min(10, Math.max(1, Math.round(sets))),
    repRange,
    effort,
    restSeconds: Math.min(600, Math.max(30, Math.round(number(candidate.restSeconds) ?? 90))),
    startingLoadKg: startingLoadKg === null ? null : Math.max(0, startingLoadKg),
    progression: progression(candidate.progression, name, profile),
    note: note.slice(0, 240),
    rationale: text(
      candidate.rationale,
      reference
        ? `Anchored to ${reference.sessions} logged sessions and its current progression signal.`
        : 'No matching Hevy history was found; start conservatively and establish a baseline.',
    ).slice(0, 320),
  };
}

export function estimateSessionMinutes(day: { exercises: ProgramExercise[] }) {
  return day.exercises.reduce(
    (seconds, exercise) => seconds + exercise.sets * (40 + exercise.restSeconds),
    0,
  ) / 60;
}

export function validateProgramV2(
  program: Omit<TrainingProgram, 'id' | 'createdAt'>,
  options: { requireTimeMatch?: boolean } = {},
) {
  if (program.schemaVersion !== 2 || program.days.length !== program.daysPerWeek) {
    return 'The program does not match the requested number of training days.';
  }
  if (program.days.some((day) => day.exercises.length === 0)) {
    return 'Each training day needs at least one exercise.';
  }
  const targetPattern = /\b(leg|legs|lower|quad|hamstring|glute|calf|chest|back|lat|shoulder|delt|arm|biceps|triceps)\b/gi;
  const targetTerms = program.goal.match(targetPattern) ?? [];
  if (targetTerms.length) {
    const totalSets = program.days.reduce(
      (total, day) => total + day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
      0,
    );
    const targetSets = program.days.reduce(
      (total, day) =>
        total +
        day.exercises
          .filter((exercise) => targetTerms.some((term) => exercise.name.toLowerCase().includes(term.toLowerCase())))
          .reduce((sum, exercise) => sum + exercise.sets, 0),
      0,
    );
    if (totalSets > 0 && targetSets / totalSets < 0.4) {
      return 'The program is not sufficiently aligned with the requested target.';
    }
  }
  if (options.requireTimeMatch) {
    const estimates = program.days.map(estimateSessionMinutes);
    const average = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
    const tolerance = program.minutesPerSession * 0.15;
    if (Math.abs(average - program.minutesPerSession) > tolerance) {
      return `Estimated sessions are ${Math.round(average)} minutes, outside the ${Math.round(tolerance)} minute tolerance.`;
    }
  }
  return null;
}

export function normalizeProgramV2(
  value: unknown,
  metadata: ProgramMetadata,
  profile: AthleteProfile,
  dashboard?: DashboardData,
  options: { requireTimeMatch?: boolean } = {},
) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.days) || candidate.days.length !== metadata.daysPerWeek) return null;
  const days = candidate.days.map((rawDay, dayIndex) => {
    if (!rawDay || typeof rawDay !== 'object') return null;
    const day = rawDay as Record<string, unknown>;
    if (!Array.isArray(day.exercises) || day.exercises.length === 0) return null;
    const exercises = day.exercises.map((exercise) => normalizeExercise(exercise, profile, dashboard));
    if (exercises.some((exercise) => !exercise)) return null;
    return {
      day: Number.isFinite(Number(day.day)) ? Math.max(1, Math.round(Number(day.day))) : dayIndex + 1,
      title: text(day.title, `Session ${dayIndex + 1}`).slice(0, 100),
      focus: text(day.focus, 'Balanced development').slice(0, 140),
      hevyRoutineId: text(day.hevyRoutineId) || null,
      exercises: exercises as ProgramExercise[],
    };
  });
  if (days.some((day) => !day)) return null;
  const normalized = {
    schemaVersion: 2 as const,
    title: text(candidate.title, `${metadata.durationWeeks}-Week Training Block`).slice(0, 160),
    goal: metadata.goal,
    durationWeeks: metadata.durationWeeks,
    daysPerWeek: metadata.daysPerWeek,
    minutesPerSession: metadata.minutesPerSession,
    overview: text(candidate.overview, 'A tailored training block built around your constraints.').slice(0, 800),
    progression: text(candidate.progression, 'Build reps inside the range before adding the smallest practical load.').slice(0, 800),
    deload: text(candidate.deload, 'Reduce sets when performance, motivation, or recovery clearly deteriorates.').slice(0, 800),
    days: days as NonNullable<(typeof days)[number]>[],
  } satisfies Omit<TrainingProgram, 'id' | 'createdAt'>;
  return validateProgramV2(normalized, options) ? null : normalized;
}

export function migrateProgramContent(value: unknown): Partial<TrainingProgram> {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const metadata: ProgramMetadata = {
    goal: text(candidate.goal, 'Build muscle and strength'),
    durationWeeks: Math.max(1, Math.round(number(candidate.durationWeeks) ?? 8)),
    daysPerWeek: Math.max(1, Math.round(number(candidate.daysPerWeek) ?? 4)),
    minutesPerSession: Math.max(1, Math.round(number(candidate.minutesPerSession) ?? 60)),
  };
  const profile = {
    loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
  } as AthleteProfile;
  const normalized = normalizeProgramV2(candidate, metadata, profile);
  if (normalized) return normalized;
  return {
    schemaVersion: 2,
    ...metadata,
    title: text(candidate.title, `${metadata.durationWeeks}-Week Training Block`),
    overview: text(candidate.overview, 'A saved training block.'),
    progression: text(candidate.progression, 'Build reps inside the prescribed range before adding load.'),
    deload: text(candidate.deload, 'Reduce sets when recovery or performance deteriorates.'),
    days: [],
  };
}
