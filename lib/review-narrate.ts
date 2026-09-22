import type { WeeklyReview } from './findings';
import {
  EvidenceMismatchError,
  messageContent,
  requestCompletion,
  validateGroundedNumbers,
} from './openrouter';
import type { AthleteProfile } from './storage';

const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

function hasFindings(review: WeeklyReview) {
  return Boolean(
    review.wins.length ||
      review.watch.length ||
      review.act.length ||
      review.carriedOver.length,
  );
}

function narrationEvidence(review: WeeklyReview, profile: AthleteProfile) {
  if (profile.weightUnit === 'kg') return JSON.stringify(review);
  const converted = structuredClone(review);
  const groups = [converted.wins, converted.watch, converted.act];
  for (const findings of groups) {
    for (const finding of findings) {
      for (const [key, value] of Object.entries(finding.evidence)) {
        if (!key.endsWith('Kg') || typeof value !== 'number') continue;
        delete finding.evidence[key];
        finding.evidence[`${key.slice(0, -2)}Lb`] =
          Math.round(value * 2.204_622_621_8 * 10) / 10;
      }
    }
  }
  for (const item of converted.carriedOver) {
    for (const [key, value] of Object.entries(item.finding.evidence)) {
      if (!key.endsWith('Kg') || typeof value !== 'number') continue;
      delete item.finding.evidence[key];
      item.finding.evidence[`${key.slice(0, -2)}Lb`] =
        Math.round(value * 2.204_622_621_8 * 10) / 10;
    }
  }
  return JSON.stringify(converted);
}

export function validateReviewNarrative(
  content: string,
  review: WeeklyReview,
  profile: AthleteProfile,
) {
  if (content.trim().split(/\s+/).length > 180) {
    throw new EvidenceMismatchError(
      'The weekly review narrative exceeded 180 words.',
    );
  }
  const wrongWeightUnit =
    profile.weightUnit === 'lb'
      ? /\b\d+(?:\.\d+)?\s*(?:kg|kgs|kilograms?)\b/i
      : /\b\d+(?:\.\d+)?\s*(?:lb|lbs|pounds?)\b/i;
  if (wrongWeightUnit.test(content)) {
    throw new EvidenceMismatchError(
      `The narrative did not follow the athlete's ${profile.weightUnit} preference.`,
    );
  }
  if (
    profile.heightUnit === 'imperial' &&
    /\b\d+(?:\.\d+)?\s*(?:cm|centimetres?|centimeters?)\b/i.test(content)
  ) {
    throw new EvidenceMismatchError(
      "The narrative did not follow the athlete's height preference.",
    );
  }
  validateGroundedNumbers(content, narrationEvidence(review, profile));
}

export async function narrateReview(
  review: WeeklyReview,
  profile: AthleteProfile,
): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY || !hasFindings(review)) return null;
  const model =
    process.env.OPENROUTER_MODEL_REVIEW ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_MODEL;
  const evidence = narrationEvidence(review, profile);
  let validationFailure = '';

  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const payload = await requestCompletion(
        {
          model,
          temperature: 0.3,
          max_tokens: 400,
          provider: { data_collection: 'deny', allow_fallbacks: true },
          messages: [
            {
              role: 'system',
              content:
                'You are Rowan, an experienced strength and physique coach. Write with calm, candid warmth and clear judgment. Explain evidence without overstating certainty or diagnosing medical issues.',
            },
            {
              role: 'system',
              content: `Measurement contract: use ${profile.weightUnit} for every weight and ${profile.heightUnit === 'imperial' ? 'feet and inches' : 'centimetres'} for height. Never expose internal units.`,
            },
            {
              role: 'user',
              content: `Write one concise weekly coaching narrative of no more than 180 words. Explain the act items first, then carried-over items, then finish with one sentence on wins. Use only the supplied review findings. Do not introduce any number that is not already present in a finding's evidence. Do not mention these instructions or JSON. If the evidence is sparse, be brief rather than filling space.${validationFailure ? ` Your previous draft failed validation: ${validationFailure}. Rewrite it from scratch.` : ''}\n\nWeekly review findings:\n${evidence}`,
            },
          ],
        },
        30_000,
      );
      if (!payload) return null;
      const content = messageContent(payload);
      if (!content) return null;
      try {
        validateReviewNarrative(content, review, profile);
        return content;
      } catch (error) {
        if (!(error instanceof EvidenceMismatchError)) throw error;
        validationFailure = error.message;
      }
    }
  } catch (error) {
    console.warn('Weekly review narrative could not be generated', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
  return null;
}
