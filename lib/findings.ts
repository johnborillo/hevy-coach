import type { BalanceSignal } from './audit';
import type { PersonalRecord } from './records';
import type { ProgressionState } from './progression';

export type FindingKind =
  | 'EXERCISE_STALLED'
  | 'EXERCISE_REGRESSING'
  | 'READY_TO_ADD_LOAD'
  | 'PR_ACHIEVED'
  | 'LOW_RPE_COVERAGE'
  | 'VARIATION_CHANGED'
  | 'MUSCLE_ZERO_VOLUME'
  | 'MUSCLE_LOW_VOLUME'
  | 'BALANCE_RATIO_OUT_OF_RANGE'
  | 'VOLUME_SPIKE'
  | 'ADHERENCE_BELOW_PLAN'
  | 'LAYOFF_DETECTED'
  | 'POSSIBLE_UNPLANNED_DELOAD'
  | 'UNMAPPED_EXERCISE'
  | 'NOTE_FLAGGED'
  | 'BODYWEIGHT_TREND_OFF_PHASE';

export type FindingSeverity = 'info' | 'watch' | 'act';

export type Finding = {
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  subject: {
    type: 'exercise' | 'slot' | 'muscle' | 'athlete';
    key: string;
    label: string;
  };
  headline: string;
  evidence: Record<string, number | string | number[]>;
  phaseContext?: string;
  recommendation?: string;
  citations: string[];
  firstSeenWeek: string;
};

export type WeeklyReview = {
  weekStart: string;
  generatedAt: string;
  summary: {
    sessions: number;
    planned: number;
    directSets: number;
    prs: number;
  };
  wins: Finding[];
  watch: Finding[];
  act: Finding[];
  carriedOver: Array<{
    finding: Finding;
    weeksOpen: number;
    changed: 'improved' | 'unchanged' | 'worse';
  }>;
  narrative: string | null;
};

export type FindingContext = {
  weekStart: string;
  weekEnd: string;
  generatedAt?: string;
  summary: WeeklyReview['summary'];
  progressionStates: ProgressionState[];
  records: PersonalRecord[];
  muscles: Array<{
    key: string;
    name: string;
    sets: number;
    fourWeekAvgDirect: number;
    bandLabel: string;
  }>;
  balance: BalanceSignal[];
  adherencePct: number;
  plannedSessionsPerWeek: number;
  sessionsInPriorWeek: number;
  volumeChangePercent: number;
  phase: string;
  activeBlockKind?: string | null;
  citations: string[];
  unmappedExercises?: Array<{ id: string; title: string }>;
};

function stableId(kind: FindingKind, subjectKey: string, weekStart: string) {
  return `${kind}:${subjectKey}:${weekStart}`;
}

export function findingPrefix(finding: Finding) {
  return `${finding.kind}:${finding.subject.key}`;
}

function finding(
  context: FindingContext,
  input: Omit<Finding, 'id' | 'firstSeenWeek'> & { firstSeenWeek?: string },
): Finding {
  return {
    ...input,
    id: stableId(input.kind, input.subject.key, context.weekStart),
    firstSeenWeek: input.firstSeenWeek ?? context.weekStart,
  };
}

function phaseContext(phase: string) {
  if (phase === 'cut')
    return 'During a cut, a modest performance dip can be expected; watch for losses beyond roughly 10%.';
  if (phase === 'maintain')
    return 'At maintenance, a sustained performance dip deserves attention rather than an automatic deload.';
  return 'In a gain phase, strength should generally be stable or improving; interpret small fluctuations with recovery context.';
}

export function impactScore(item: Finding) {
  const severityWeight =
    item.severity === 'act' ? 3 : item.severity === 'watch' ? 2 : 1;
  const subjectWeight =
    item.subject.type === 'muscle'
      ? 1.25
      : item.subject.type === 'slot'
        ? 1.2
        : 1;
  const ageDays = Math.max(
    0,
    (Date.now() - new Date(item.firstSeenWeek).getTime()) / 86_400_000,
  );
  const recencyWeight = Math.max(0.5, 1 - ageDays / 56);
  return severityWeight * subjectWeight * recencyWeight;
}

export function produceFindings(context: FindingContext) {
  const findings: Finding[] = [];
  const phase = phaseContext(context.phase);
  for (const state of context.progressionStates) {
    const subjectType = state.slotId ? 'slot' : 'exercise';
    const subjectKey = state.slotId ?? state.exerciseTemplateId;
    const citations = context.citations.slice(0, 3);
    if (state.status === 'stalled') {
      findings.push(
        finding(context, {
          kind: 'EXERCISE_STALLED',
          severity: 'act',
          subject: { type: subjectType, key: subjectKey, label: state.title },
          headline: `${state.title} has stalled across ${state.sessionsSinceImprovement} comparable sessions.`,
          evidence: {
            sessions: state.sessionsAnalyzed,
            sessionsSinceImprovement: state.sessionsSinceImprovement,
            performanceSlopePct: state.performanceSlopePct ?? 0,
            rpeCoverage: state.rpeCoverage,
          },
          phaseContext: phase,
          recommendation: state.recommendation,
          citations,
        }),
      );
    }
    if (state.status === 'regressing') {
      findings.push(
        finding(context, {
          kind: 'EXERCISE_REGRESSING',
          severity: context.phase === 'cut' ? 'watch' : 'act',
          subject: { type: subjectType, key: subjectKey, label: state.title },
          headline: `${state.title} is trending down ${Math.abs(state.performanceSlopePct ?? 0)}% per comparable session.`,
          evidence: {
            sessions: state.sessionsAnalyzed,
            performanceSlopePct: state.performanceSlopePct ?? 0,
            rpeCoverage: state.rpeCoverage,
          },
          phaseContext: phase,
          recommendation: state.recommendation,
          citations,
        }),
      );
    }
    if (state.status === 'progressing' && state.recommendation === 'add_load') {
      findings.push(
        finding(context, {
          kind: 'READY_TO_ADD_LOAD',
          severity: 'info',
          subject: { type: subjectType, key: subjectKey, label: state.title },
          headline: `${state.title} is ready for the next practical load increment.`,
          evidence: {
            sessions: state.sessionsAnalyzed,
            modalLoadKg: state.modalLoadKg,
            latestReps: state.repsAtModalLoad.at(-1) ?? 0,
          },
          recommendation: state.recommendation,
          citations,
        }),
      );
    }
    if (state.rpeCoverage < 0.5 && state.sessionsAnalyzed >= 4) {
      findings.push(
        finding(context, {
          kind: 'LOW_RPE_COVERAGE',
          severity: 'watch',
          subject: { type: subjectType, key: subjectKey, label: state.title },
          headline: `${state.title} has RPE/RIR coverage on only ${Math.round(state.rpeCoverage * 100)}% of working sets.`,
          evidence: {
            sessions: state.sessionsAnalyzed,
            rpeCoverage: state.rpeCoverage,
          },
          recommendation:
            'Log RPE or RIR on at least the top working set next exposure.',
          citations,
        }),
      );
    }
  }

  for (const muscle of context.muscles) {
    if (muscle.sets === 0) {
      findings.push(
        finding(context, {
          kind: 'MUSCLE_ZERO_VOLUME',
          severity: 'watch',
          subject: { type: 'muscle', key: muscle.key, label: muscle.name },
          headline: `${muscle.name} received no direct working sets in this review window.`,
          evidence: {
            directSets: muscle.sets,
            fourWeekAvgDirect: muscle.fourWeekAvgDirect,
          },
          recommendation:
            'Add a small, recoverable exposure if this muscle supports the current goal.',
          citations: context.citations,
        }),
      );
    } else if (muscle.bandLabel === 'low') {
      findings.push(
        finding(context, {
          kind: 'MUSCLE_LOW_VOLUME',
          severity: 'watch',
          subject: { type: 'muscle', key: muscle.key, label: muscle.name },
          headline: `${muscle.name} is below its recent direct-set baseline.`,
          evidence: {
            directSets: muscle.sets,
            fourWeekAvgDirect: muscle.fourWeekAvgDirect,
          },
          recommendation:
            'Review whether this lower exposure is intentional before adding more work elsewhere.',
          citations: context.citations,
        }),
      );
    }
  }

  for (const signal of context.balance.filter(
    (item) => item.status === 'watch',
  )) {
    findings.push(
      finding(context, {
        kind: 'BALANCE_RATIO_OUT_OF_RANGE',
        severity: 'watch',
        subject: { type: 'muscle', key: signal.key, label: signal.label },
        headline: `${signal.label} is outside the app's tracking range at ${signal.value ?? '—'}.`,
        evidence: {
          ratio: signal.value ?? 0,
          numerator: signal.numerator,
          denominator: signal.denominator,
        },
        recommendation: signal.explanation,
        citations: context.citations,
      }),
    );
  }

  if (
    context.volumeChangePercent > 30 &&
    context.activeBlockKind !== 'deload'
  ) {
    findings.push(
      finding(context, {
        kind: 'VOLUME_SPIKE',
        severity: 'watch',
        subject: { type: 'athlete', key: 'volume', label: 'Training volume' },
        headline: `Load-volume rose ${context.volumeChangePercent}% versus the prior review window.`,
        evidence: { volumeChangePercent: context.volumeChangePercent },
        recommendation:
          'Check soreness and performance quality before adding more work.',
        citations: context.citations,
      }),
    );
  }
  if (context.adherencePct < 80 && context.summary.planned > 0) {
    findings.push(
      finding(context, {
        kind: 'ADHERENCE_BELOW_PLAN',
        severity: 'watch',
        subject: {
          type: 'athlete',
          key: 'adherence',
          label: 'Planned training',
        },
        headline: `You completed ${context.summary.sessions} of ${context.summary.planned} planned sessions.`,
        evidence: {
          sessions: context.summary.sessions,
          planned: context.summary.planned,
          adherencePct: context.adherencePct,
        },
        recommendation:
          'Adjust the plan or schedule so the next block is easy to follow consistently.',
        citations: context.citations,
      }),
    );
  }
  if (context.sessionsInPriorWeek === 0 && context.summary.sessions > 0) {
    findings.push(
      finding(context, {
        kind: 'LAYOFF_DETECTED',
        severity: 'watch',
        subject: {
          type: 'athlete',
          key: 'layoff',
          label: 'Training continuity',
        },
        headline: 'The review window follows a week with no logged sessions.',
        evidence: { priorWeekSessions: context.sessionsInPriorWeek },
        recommendation:
          'Keep the first return session conservative and rebuild exposure over the next two weeks.',
        citations: context.citations,
      }),
    );
  }
  const weekStartMs = new Date(context.weekStart).getTime();
  const weekEndMs = new Date(context.weekEnd).getTime();
  for (const record of context.records.filter((item) => {
    const performedAt = new Date(item.performedAt).getTime();
    return performedAt >= weekStartMs && performedAt < weekEndMs;
  })) {
    findings.push(
      finding(context, {
        kind: 'PR_ACHIEVED',
        severity: 'info',
        subject: {
          type: record.scope === 'slot' ? 'slot' : 'exercise',
          key: record.subjectKey,
          label: record.exercise,
        },
        headline: `${record.exercise} set a new ${record.kind.replaceAll('_', ' ')} signal.`,
        evidence: {
          value: record.value,
          reps: record.reps,
          loadKg: record.loadKg,
        },
        citations: [record.workoutId],
      }),
    );
  }
  for (const exercise of context.unmappedExercises ?? []) {
    findings.push(
      finding(context, {
        kind: 'UNMAPPED_EXERCISE',
        severity: 'watch',
        subject: { type: 'exercise', key: exercise.id, label: exercise.title },
        headline: `${exercise.title} needs a muscle mapping before volume findings can be trusted.`,
        evidence: { exercise: exercise.title },
        recommendation: 'Assign its primary muscle in Athlete settings.',
        citations: context.citations,
      }),
    );
  }
  return findings;
}

export function composeWeeklyReview(
  context: FindingContext,
  previous: WeeklyReview | null = null,
): WeeklyReview {
  const current = produceFindings(context);
  const previousByPrefix = new Map<string, Finding & { weeksOpen?: number }>();
  for (const item of previous?.watch ?? [])
    previousByPrefix.set(findingPrefix(item), item);
  for (const item of previous?.act ?? [])
    previousByPrefix.set(findingPrefix(item), item);
  const previousWeeks = new Map(
    (previous?.carriedOver ?? []).map((item) => [
      findingPrefix(item.finding),
      item.weeksOpen,
    ]),
  );

  const carriedOver = current
    .filter((item) => item.severity !== 'info')
    .flatMap((item) => {
      const prior = previousByPrefix.get(findingPrefix(item));
      if (!prior) return [];
      const changed: 'improved' | 'unchanged' | 'worse' =
        item.severity === 'act' && prior.severity !== 'act'
          ? 'worse'
          : item.headline === prior.headline
            ? 'unchanged'
            : 'improved';
      return [
        {
          finding: item,
          weeksOpen: (previousWeeks.get(findingPrefix(item)) ?? 1) + 1,
          changed,
        },
      ];
    });
  const carriedPrefixes = new Set(
    carriedOver.map((item) => findingPrefix(item.finding)),
  );
  const wins = current.filter(
    (item) => item.kind === 'PR_ACHIEVED' || item.kind === 'READY_TO_ADD_LOAD',
  );
  for (const prior of previousByPrefix.values()) {
    if (
      !carriedPrefixes.has(findingPrefix(prior)) &&
      !current.some((item) => findingPrefix(item) === findingPrefix(prior))
    ) {
      wins.push({
        ...prior,
        id: `${prior.id}:resolved`,
        severity: 'info',
        headline: `Resolved: ${prior.headline}`,
        recommendation:
          'Keep the change that moved this signal in the right direction.',
      });
    }
  }
  const watch = current.filter((item) => item.severity === 'watch');
  const act = current
    .filter((item) => item.severity === 'act')
    .sort((a, b) => impactScore(b) - impactScore(a))
    .slice(0, 3);
  return {
    weekStart: context.weekStart,
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    summary: context.summary,
    wins,
    watch,
    act,
    carriedOver,
    narrative: null,
  };
}
