export const COACH_MODELS = [
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
  },
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'GPT-6 Luna',
  },
  {
    id: 'openai/gpt-oss-120b:free',
    label: 'GPT-OSS 120B (free)',
  },
] as const;

export const COACHES = [
  {
    id: 'rowan',
    name: 'Rowan',
    initials: 'R',
    specialty: 'Strength & physique',
    description:
      'A balanced, evidence-led coach for strength, muscle, and sustainable programming.',
  },
  {
    id: 'mira',
    name: 'Mira',
    initials: 'M',
    specialty: 'Hypertrophy & recovery',
    description:
      'Focuses on productive volume, exercise stimulus, fatigue, nutrition, and adherence.',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    initials: 'A',
    specialty: 'Strength & performance',
    description:
      'Focuses on lift skill, specificity, readiness, and practical performance progression.',
  },
] as const;

export type CoachModelId = (typeof COACH_MODELS)[number]['id'];
export type CoachId = (typeof COACHES)[number]['id'];

export const DEFAULT_COACH_MODEL: CoachModelId = 'z-ai/glm-5.3-flash';
export const DEFAULT_COACH_ID: CoachId = 'rowan';

export function isCoachModelId(value: unknown): value is CoachModelId {
  return COACH_MODELS.some((model) => model.id === value);
}

export function isCoachId(value: unknown): value is CoachId {
  return COACHES.some((coach) => coach.id === value);
}

const MESSAGE_METADATA_PREFIX = '@hevy-coach:';

export function encodeCoachMessageMetadata(coachId: CoachId, model: string) {
  return `${MESSAGE_METADATA_PREFIX}${coachId}|${model}`;
}

export function decodeCoachMessageMetadata(value: string | null) {
  if (!value?.startsWith(MESSAGE_METADATA_PREFIX)) {
    return { coachId: DEFAULT_COACH_ID, model: value };
  }
  const separator = value.indexOf('|', MESSAGE_METADATA_PREFIX.length);
  if (separator < 0) {
    return { coachId: DEFAULT_COACH_ID, model: value };
  }
  const coachId = value.slice(MESSAGE_METADATA_PREFIX.length, separator);
  return {
    coachId: isCoachId(coachId) ? coachId : DEFAULT_COACH_ID,
    model: value.slice(separator + 1) || null,
  };
}
