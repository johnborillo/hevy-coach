export const COACH_MODELS = [
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'GPT-6 Luna',
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

export function encodeCoachMessageMetadata(
  coachId: CoachId,
  model: string,
  fallbackReason?: string | null,
) {
  const reason = fallbackReason
    ? `|${encodeURIComponent(fallbackReason.slice(0, 600))}`
    : '';
  return `${MESSAGE_METADATA_PREFIX}${coachId}|${model}${reason}`;
}

export function decodeCoachMessageMetadata(value: string | null) {
  if (!value?.startsWith(MESSAGE_METADATA_PREFIX)) {
    return { coachId: DEFAULT_COACH_ID, model: value, fallbackReason: null };
  }
  const separator = value.indexOf('|', MESSAGE_METADATA_PREFIX.length);
  if (separator < 0) {
    return { coachId: DEFAULT_COACH_ID, model: value, fallbackReason: null };
  }
  const coachId = value.slice(MESSAGE_METADATA_PREFIX.length, separator);
  const encodedModel = value.slice(separator + 1);
  const modelSeparator = encodedModel.indexOf('|');
  const model = modelSeparator < 0 ? encodedModel : encodedModel.slice(0, modelSeparator);
  const encodedReason = modelSeparator < 0 ? '' : encodedModel.slice(modelSeparator + 1);
  let fallbackReason: string | null = null;
  if (encodedReason) {
    try {
      fallbackReason = decodeURIComponent(encodedReason);
    } catch {
      fallbackReason = encodedReason;
    }
  }
  return {
    coachId: isCoachId(coachId) ? coachId : DEFAULT_COACH_ID,
    model: model || null,
    fallbackReason,
  };
}
