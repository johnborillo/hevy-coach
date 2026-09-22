import type { ClassifiedSet } from './sets';

export type ProgressionStatus =
  | 'progressing'
  | 'holding'
  | 'stalled'
  | 'regressing'
  | 'insufficient_data'
  | 'variable_load';

export type ProgressionRecommendation =
  | 'add_load'
  | 'add_reps'
  | 'hold'
  | 'reduce_load'
  | 'reduce_volume'
  | 'swap_or_rotate'
  | 'log_rpe'
  | 'none';

export type ProgressionSession = {
  performedAt: string;
  sets: ClassifiedSet[];
  exerciseTemplateId?: string;
  exerciseTitle?: string;
};

export type ProgressionState = {
  exerciseTemplateId: string;
  slotId: string | null;
  title: string;
  variationChangeAt: string | null;
  sessionsAnalyzed: number;
  lastPerformedAt: string;
  modalLoadKg: number;
  repsAtModalLoad: number[];
  targetRepRange: [number, number] | null;
  rpeCoverage: number;
  lastSetRpe: number[];
  rpeSlope: number | null;
  performanceIndex: number[];
  performanceSlopePct: number | null;
  sessionsSinceImprovement: number;
  status: ProgressionStatus;
  recommendation: ProgressionRecommendation;
  rationale: string;
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function theilSen(values: number[]) {
  if (values.length < 2) return null;
  const slopes: number[] = [];
  for (let start = 0; start < values.length - 1; start += 1) {
    for (let end = start + 1; end < values.length; end += 1) {
      slopes.push((values[end] - values[start]) / (end - start));
    }
  }
  return median(slopes);
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function inferRepRange(reps: number[]): [number, number] | null {
  if (!reps.length) return null;
  const sorted = [...reps].sort((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const upper = sorted[Math.ceil((sorted.length - 1) * 0.75)];
  if (upper - lower >= 3) return [lower, upper];
  return [Math.max(1, lower - 1), Math.max(lower + 2, upper + 2)];
}

function mode(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    const normalized = round(value);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [
      0, 0,
    ]
  );
}

function sessionsSinceImprovement(values: number[]) {
  if (!values.length) return 0;
  let lastImprovement = -1;
  for (let index = 1; index < values.length; index += 1) {
    const prior = values.slice(Math.max(0, index - 3), index);
    if (values[index] > Math.max(...prior)) lastImprovement = index;
  }
  return lastImprovement < 0 ? values.length : values.length - lastImprovement;
}

function rationale(
  status: ProgressionStatus,
  recommendation: ProgressionRecommendation,
  state: {
    sessions: number;
    sessionsSinceImprovement: number;
    rpeCoverage: number;
    performanceSlopePct: number | null;
  },
) {
  if (status === 'insufficient_data') {
    return `${state.sessions} comparable sessions logged; four are needed before judging progression.`;
  }
  if (status === 'variable_load') {
    return 'Recent loads vary too much to establish one repeatable progression signal.';
  }
  if (recommendation === 'add_load') {
    return 'Recent performance is improving and the top of the inferred rep range has been reached.';
  }
  if (recommendation === 'add_reps') {
    return 'Performance is improving; keep the load stable and build reps before adding weight.';
  }
  if (recommendation === 'log_rpe') {
    return `Performance is holding, but only ${Math.round(state.rpeCoverage * 100)}% of working sets include effort data.`;
  }
  if (recommendation === 'reduce_load') {
    return `${state.sessionsSinceImprovement} sessions have passed without improvement while recent effort is near failure.`;
  }
  if (recommendation === 'swap_or_rotate') {
    return `${state.sessionsSinceImprovement} sessions have passed without a clear improvement; consider a small variation change.`;
  }
  if (recommendation === 'reduce_volume') {
    return `The robust performance trend is down ${Math.abs(state.performanceSlopePct ?? 0).toFixed(1)}% per session.`;
  }
  return 'Performance is stable; keep the current exposure and reassess after another session.';
}

export function computeProgression(
  exerciseTemplateId: string,
  title: string,
  inputSessions: ProgressionSession[],
  options: {
    targetRepRange?: [number, number] | null;
    slotId?: string | null;
  } = {},
): ProgressionState {
  const sessions = [...inputSessions]
    .sort(
      (a, b) =>
        new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime(),
    )
    .slice(-12)
    .map((session) => ({
      ...session,
      sets: session.sets.filter((set) => set.countsAsWorking > 0),
    }))
    .filter((session) => session.sets.length > 0);
  const recentLoadSets = sessions
    .slice(-3)
    .flatMap((session) => session.sets)
    .filter(
      (set): set is ClassifiedSet & { loadKg: number } =>
        set.loadKg !== null && set.loadKg > 0,
    );
  const [modalLoadKg, modalLoadCount] = mode(
    recentLoadSets.map((set) => set.loadKg),
  );
  const repsAtModalLoad = sessions
    .map((session) =>
      Math.max(
        0,
        ...session.sets
          .filter(
            (set) =>
              set.loadKg !== null &&
              Math.abs(set.loadKg - modalLoadKg) < 0.01 &&
              set.reps !== null,
          )
          .map((set) => set.reps ?? 0),
      ),
    )
    .filter((reps) => reps > 0);
  const targetRepRange =
    options.targetRepRange ?? inferRepRange(repsAtModalLoad.slice(-6));
  const workingSets = sessions.flatMap((session) => session.sets);
  const setsWithRpe = workingSets.filter((set) => set.rpe !== null);
  const rpeCoverage = workingSets.length
    ? setsWithRpe.length / workingSets.length
    : 0;
  const lastSetRpe = sessions
    .map(
      (session) =>
        [...session.sets].reverse().find((set) => set.rpe !== null)?.rpe ??
        null,
    )
    .filter((value): value is number => value !== null);
  const rpeSlope = rpeCoverage >= 0.5 ? theilSen(lastSetRpe.slice(-6)) : null;
  const performanceIndex = sessions.map((session) => {
    const e1rm = session.sets
      .map((set) => set.e1rmKg)
      .filter((value): value is number => value !== null);
    if (e1rm.length) return Math.max(...e1rm);
    const modalPerformance = session.sets
      .filter(
        (set) =>
          set.loadKg !== null &&
          Math.abs(set.loadKg - modalLoadKg) < 0.01 &&
          set.reps !== null,
      )
      .map((set) => (set.loadKg ?? 0) * (set.reps ?? 0));
    if (modalPerformance.length) return Math.max(...modalPerformance);
    return Math.max(
      0,
      ...session.sets.map((set) => (set.loadKg ?? 0) * (set.reps ?? 0)),
    );
  });
  const performanceSlope =
    performanceIndex.length >= 5 ? theilSen(performanceIndex) : null;
  const performanceMean = performanceIndex.length
    ? performanceIndex.reduce((sum, value) => sum + value, 0) /
      performanceIndex.length
    : 0;
  const performanceSlopePct =
    performanceSlope !== null && performanceMean > 0
      ? (performanceSlope / performanceMean) * 100
      : null;
  const sinceImprovement = sessionsSinceImprovement(performanceIndex);
  const lastFourSets = sessions.slice(-4).flatMap((session) => session.sets);
  const distinctRecentLoads = new Set(
    lastFourSets
      .map((set) => set.loadKg)
      .filter((load): load is number => load !== null && load > 0)
      .map((load) => round(load)),
  );
  const variableLoad =
    distinctRecentLoads.size > 3 &&
    modalLoadCount / Math.max(recentLoadSets.length, 1) < 0.5;

  let status: ProgressionStatus;
  if (sessions.length < 4) status = 'insufficient_data';
  else if (variableLoad) status = 'variable_load';
  else if ((performanceSlopePct ?? 0) > 0.75 || sinceImprovement <= 1) {
    status = 'progressing';
  } else if (sinceImprovement >= 4 && (rpeSlope ?? 0) >= 0.25) {
    status = 'stalled';
  } else if (
    performanceSlopePct !== null &&
    performanceSlopePct < -1 &&
    sessions.length >= 5
  ) {
    status = 'regressing';
  } else status = 'holding';

  const latestSession = sessions.at(-1);
  const latestSessionMaxLoad = Math.max(
    0,
    ...(latestSession?.sets.map((set) => set.loadKg ?? 0) ?? []),
  );
  const latestSessionReps = Math.max(
    0,
    ...(latestSession?.sets
      .filter(
        (set) =>
          set.reps !== null &&
          set.loadKg !== null &&
          set.loadKg >= Math.min(modalLoadKg, latestSessionMaxLoad),
      )
      .map((set) => set.reps ?? 0) ?? []),
  );
  const latestReps = latestSessionReps || repsAtModalLoad.at(-1) || 0;
  const latestRpe = lastSetRpe.at(-1) ?? null;
  let recommendation: ProgressionRecommendation = 'none';
  if (status === 'progressing') {
    recommendation =
      targetRepRange && latestReps >= targetRepRange[1]
        ? 'add_load'
        : 'add_reps';
  } else if (status === 'holding') {
    recommendation = rpeCoverage < 0.5 ? 'log_rpe' : 'hold';
  } else if (status === 'stalled') {
    recommendation =
      latestRpe !== null && latestRpe >= 9.5 ? 'reduce_load' : 'swap_or_rotate';
  } else if (status === 'regressing') recommendation = 'reduce_volume';

  let variationChangeAt: string | null = null;
  let latestVariationChangeIndex = -1;
  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1];
    const current = sessions[index];
    if (
      previous.exerciseTemplateId &&
      current.exerciseTemplateId &&
      previous.exerciseTemplateId !== current.exerciseTemplateId
    ) {
      latestVariationChangeIndex = index;
      variationChangeAt = current.performedAt;
    }
  }
  const sessionsSinceVariation =
    latestVariationChangeIndex >= 0
      ? sessions.length - 1 - latestVariationChangeIndex
      : null;
  if (
    sessionsSinceVariation !== null &&
    sessionsSinceVariation >= 1 &&
    sessionsSinceVariation <= 2
  ) {
    recommendation = 'none';
  }

  return {
    exerciseTemplateId,
    slotId: options.slotId ?? null,
    title,
    variationChangeAt,
    sessionsAnalyzed: sessions.length,
    lastPerformedAt: sessions.at(-1)?.performedAt ?? '',
    modalLoadKg: round(modalLoadKg),
    repsAtModalLoad,
    targetRepRange,
    rpeCoverage: round(rpeCoverage, 3),
    lastSetRpe,
    rpeSlope: rpeSlope === null ? null : round(rpeSlope, 3),
    performanceIndex: performanceIndex.map((value) => round(value)),
    performanceSlopePct:
      performanceSlopePct === null ? null : round(performanceSlopePct),
    sessionsSinceImprovement: sinceImprovement,
    status,
    recommendation,
    rationale:
      sessionsSinceVariation !== null &&
      sessionsSinceVariation >= 1 &&
      sessionsSinceVariation <= 2
        ? 'New exercise variation; establish a two-session baseline before changing load or volume.'
        : rationale(status, recommendation, {
            sessions: sessions.length,
            sessionsSinceImprovement: sinceImprovement,
            rpeCoverage,
            performanceSlopePct,
          }),
  };
}
