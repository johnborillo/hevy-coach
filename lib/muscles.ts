import type { ExerciseTemplate } from './hevy-types';

export const MUSCLES = [
  'chest_upper',
  'chest_mid_lower',
  'lats',
  'upper_back',
  'traps',
  'lower_back',
  'delts_front',
  'delts_side',
  'delts_rear',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'adductors',
  'calves',
  'abs',
  'obliques',
  'neck',
  'cardio',
  'other',
] as const;

export type Muscle = (typeof MUSCLES)[number];

export type MuscleOverride = {
  exerciseTemplateId: string;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  countsAs: number;
  slotId?: string | null;
};

export type ResolvedMuscles = {
  primary: Muscle;
  secondary: Muscle[];
  unmapped: boolean;
};

const MUSCLE_LABELS: Record<Muscle, string> = {
  chest_upper: 'Upper Chest',
  chest_mid_lower: 'Mid / Lower Chest',
  lats: 'Lats',
  upper_back: 'Upper Back',
  traps: 'Traps',
  lower_back: 'Lower Back',
  delts_front: 'Front Delts',
  delts_side: 'Side Delts',
  delts_rear: 'Rear Delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Adductors',
  calves: 'Calves',
  abs: 'Abs',
  obliques: 'Obliques',
  neck: 'Neck',
  cardio: 'Cardio',
  other: 'Other',
};

const HEVY_MUSCLE_MAP: Record<string, Muscle> = {
  abdominals: 'abs',
  abs: 'abs',
  abductors: 'glutes',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  cardio: 'cardio',
  chest: 'chest_mid_lower',
  forearms: 'forearms',
  full_body: 'other',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  lower_back: 'lower_back',
  neck: 'neck',
  obliques: 'obliques',
  quadriceps: 'quads',
  quads: 'quads',
  shoulders: 'delts_front',
  traps: 'traps',
  triceps: 'triceps',
  upper_back: 'upper_back',
};

const COARSE_TAGS = new Set([
  'shoulders',
  'chest',
  'upper_back',
  'full_body',
  'other',
]);

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase().replaceAll(' ', '_') ?? '';
}

export function isMuscle(value: unknown): value is Muscle {
  return MUSCLES.includes(value as Muscle);
}

export function muscleLabel(muscle: Muscle) {
  return MUSCLE_LABELS[muscle];
}

function titlePrimary(title: string, fallback: Muscle): Muscle {
  if (/lateral raise|upright row/i.test(title)) return 'delts_side';
  if (/rear delt|reverse (?:fly|pec deck)|face pull/i.test(title)) {
    return 'delts_rear';
  }
  if (/front raise|shoulder press|overhead press/i.test(title)) {
    return 'delts_front';
  }
  if (/incline.*(?:press|fly)|(?:press|fly).*incline/i.test(title)) {
    return 'chest_upper';
  }
  if (/shrug/i.test(title)) return 'traps';
  if (/pulldown|pull[- ]?up|chin[- ]?up/i.test(title)) return 'lats';
  if (/row/i.test(title)) return 'upper_back';
  return fallback;
}

function canonicalMuscle(value: string | undefined): Muscle | null {
  const normalized = normalize(value);
  if (isMuscle(normalized)) return normalized;
  return HEVY_MUSCLE_MAP[normalized] ?? null;
}

export function resolveMuscles(
  template: Pick<
    ExerciseTemplate,
    | 'id'
    | 'title'
    | 'primary_muscle_group'
    | 'secondary_muscle_groups'
    | 'is_custom'
  >,
  override?: MuscleOverride,
): ResolvedMuscles {
  if (override) {
    return {
      primary: override.primaryMuscle,
      secondary: [...new Set(override.secondaryMuscles)].filter(
        (muscle) => muscle !== override.primaryMuscle,
      ),
      unmapped: false,
    };
  }

  const mappedPrimary = canonicalMuscle(template.primary_muscle_group);
  const rawPrimary = normalize(template.primary_muscle_group);
  const primary =
    mappedPrimary && !COARSE_TAGS.has(rawPrimary)
      ? mappedPrimary
      : titlePrimary(template.title, mappedPrimary ?? 'other');
  const secondary = [
    ...new Set(
      (template.secondary_muscle_groups ?? [])
        .map(canonicalMuscle)
        .filter((muscle): muscle is Muscle => muscle !== null),
    ),
  ].filter((muscle) => muscle !== primary);

  return {
    primary,
    secondary,
    unmapped: !mappedPrimary && Boolean(template.is_custom),
  };
}
