import type { AthleteProfile, LoadIncrements, TrainingPhase } from './storage';
import type { TrainingBlock } from './training-block-repo';

export type BodyWeightTrend = {
  average7d: number | null;
  slopeKgPerWeek: number | null;
  latest: number | null;
};

export type AthleteContext = {
  phase: TrainingPhase;
  phaseStartedAt: string | null;
  phaseWeeks: number | null;
  bodyWeightTrend: BodyWeightTrend | null;
  activeBlock: TrainingBlock | null;
  increments: LoadIncrements;
};

export function buildAthleteContext(
  profile: AthleteProfile,
  bodyWeightTrend: BodyWeightTrend | null = null,
  activeBlock: TrainingBlock | null = null,
  now = new Date(),
): AthleteContext {
  const phaseStartedAt = profile.phaseStartedAt || null;
  const phaseStart = phaseStartedAt ? new Date(phaseStartedAt).getTime() : NaN;
  const phaseWeeks = Number.isFinite(phaseStart)
    ? Math.max(0, Math.floor((now.getTime() - phaseStart) / (7 * 86_400_000)))
    : null;
  return {
    phase: profile.phase,
    phaseStartedAt,
    phaseWeeks,
    bodyWeightTrend,
    activeBlock,
    increments: profile.loadIncrements,
  };
}

export async function getAthleteContext(userId: string) {
  const [storage, weights, blocks] = await Promise.all([
    import('./storage'),
    import('./body-weight-repo'),
    import('./training-block-repo'),
  ]);
  const [profile, bodyWeights, trainingBlocks] = await Promise.all([
    storage.getProfile(userId),
    weights.listBodyWeights(userId),
    blocks.listTrainingBlocks(userId),
  ]);
  return buildAthleteContext(
    profile,
    (await import('./body-weight')).summarizeBodyWeight(bodyWeights),
    blocks.activeTrainingBlock(trainingBlocks),
  );
}
