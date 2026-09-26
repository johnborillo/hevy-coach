export const COACH_MODELS = [
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'GPT-6 Luna',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
  },
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash (0731)',
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

export type CoachMessageFlags = {
  v: 1;
  refusal?: boolean;
  requestedModel?: string;
  notice?: string;
  validation?: 'passed' | 'passed_after_retry' | 'unverified';
  unverified?: Array<{ excerpt: string; tokens: string[] }>;
  passes?: number;
};

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
  flags?: CoachMessageFlags | null,
) {
  const reason = fallbackReason
    ? encodeURIComponent(fallbackReason.slice(0, 600))
    : '';
  const serializedFlags = flags
    ? encodeURIComponent(
        JSON.stringify({
          ...flags,
          notice: flags.notice?.slice(0, 200),
        }),
      )
    : '';
  const hasMetadata = Boolean(fallbackReason || flags);
  return `${MESSAGE_METADATA_PREFIX}${coachId}|${model}${
    hasMetadata ? `|${reason}` : ''
  }${flags ? `|${serializedFlags}` : ''}`;
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
  const model =
    modelSeparator < 0 ? encodedModel : encodedModel.slice(0, modelSeparator);
  const metadata =
    modelSeparator < 0 ? '' : encodedModel.slice(modelSeparator + 1);
  const metadataParts = metadata.split('|');
  const encodedReason = metadataParts[0] ?? '';
  let fallbackReason: string | null = null;
  if (encodedReason) {
    try {
      fallbackReason = decodeURIComponent(encodedReason);
    } catch {
      fallbackReason = encodedReason;
    }
  }
  const decoded = {
    coachId: isCoachId(coachId) ? coachId : DEFAULT_COACH_ID,
    model: model || null,
    fallbackReason,
  };
  const encodedFlags = metadataParts[1];
  if (!encodedFlags) return decoded;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(encodedFlags));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'v' in parsed &&
      parsed.v === 1
    ) {
      return { ...decoded, flags: parsed as CoachMessageFlags };
    }
  } catch {
    // Keep the message readable if metadata from a future version is malformed.
  }
  return decoded;
}
