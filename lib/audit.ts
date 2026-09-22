import { MUSCLES, muscleLabel, type Muscle } from './muscles';

export type AuditObservation = {
  workoutId: string;
  performedAt: string;
  primary: Muscle;
  secondary: Muscle[];
  countsAsWorking: number;
};

export type MuscleAudit = {
  muscle: Muscle;
  name: string;
  directSets: number;
  indirectSets: number;
  sessionsHit: number;
  previousDirectSets: number;
  fourWeekAvgDirect: number;
  bandLabel: 'zero' | 'low' | 'moderate' | 'high' | 'very_high';
};

export type BalanceSignal = {
  key: 'push_pull' | 'quad_hamstring' | 'delts' | 'upper_lower' | 'calves';
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  typicalRange: string;
  status: 'balanced' | 'watch' | 'no_data';
  explanation: string;
};

export type AdherenceWeek = {
  weekStart: string;
  label: string;
  plannedSessions: number;
  actualSessions: number;
  adherencePct: number;
};

function weekStart(value: Date) {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function band(value: number, weeklyValues: number[]): MuscleAudit['bandLabel'] {
  if (value <= 0) return 'zero';
  if (value < 4) return 'low';
  const sorted = weeklyValues.filter((item) => item > 0).sort((a, b) => a - b);
  if (!sorted.length) return 'low';
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? sorted[0];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)] ?? sorted.at(-1)!;
  if (value >= q3 * 1.15) return 'very_high';
  if (value >= q1) return 'moderate';
  return 'low';
}

export function computeMuscleAudit(
  observations: AuditObservation[],
  now = new Date(),
  windowDays = 7,
): MuscleAudit[] {
  const nowMs = now.getTime();
  const current = new Map<Muscle, { direct: number; indirect: number; sessions: Set<string> }>();
  const previous = new Map<Muscle, number>();
  const weekly = new Map<Muscle, number[]>();
  const currentWeek = weekStart(now);

  for (let weekOffset = 0; weekOffset < 8; weekOffset += 1) {
    const start = new Date(currentWeek);
    start.setUTCDate(start.getUTCDate() - weekOffset * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const totals = new Map<Muscle, number>();
    for (const observation of observations) {
      const time = new Date(observation.performedAt).getTime();
      if (time < start.getTime() || time >= end.getTime()) continue;
      totals.set(
        observation.primary,
        (totals.get(observation.primary) ?? 0) + observation.countsAsWorking,
      );
    }
    for (const muscle of MUSCLES) {
      const values = weekly.get(muscle) ?? [];
      values.push(totals.get(muscle) ?? 0);
      weekly.set(muscle, values);
    }
  }

  for (const observation of observations) {
    const age = (nowMs - new Date(observation.performedAt).getTime()) / 86_400_000;
    const isCurrent = age >= 0 && age <= windowDays;
    const isPrevious = age > windowDays && age <= windowDays * 2;
    if (!isCurrent && !isPrevious) continue;
    if (isCurrent) {
      const entry = current.get(observation.primary) ?? {
        direct: 0,
        indirect: 0,
        sessions: new Set<string>(),
      };
      entry.direct += observation.countsAsWorking;
      entry.sessions.add(observation.workoutId);
      current.set(observation.primary, entry);
      for (const secondary of observation.secondary) {
        const secondaryEntry = current.get(secondary) ?? {
          direct: 0,
          indirect: 0,
          sessions: new Set<string>(),
        };
        secondaryEntry.indirect += observation.countsAsWorking * 0.5;
        current.set(secondary, secondaryEntry);
      }
    } else {
      previous.set(
        observation.primary,
        (previous.get(observation.primary) ?? 0) + observation.countsAsWorking,
      );
    }
  }

  return MUSCLES.map((muscle) => {
    const entry = current.get(muscle);
    const weeklyValues = weekly.get(muscle) ?? [];
    const fourWeekAvgDirect =
      weeklyValues.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4;
    return {
      muscle,
      name: muscleLabel(muscle),
      directSets: round(entry?.direct ?? 0),
      indirectSets: round(entry?.indirect ?? 0),
      sessionsHit: entry?.sessions.size ?? 0,
      previousDirectSets: round(previous.get(muscle) ?? 0),
      fourWeekAvgDirect: round(fourWeekAvgDirect),
      bandLabel: band(fourWeekAvgDirect, weeklyValues),
    };
  });
}

function sum(audit: MuscleAudit[], muscles: Muscle[]) {
  const wanted = new Set(muscles);
  return audit
    .filter((item) => wanted.has(item.muscle))
    .reduce((total, item) => total + item.fourWeekAvgDirect, 0);
}

function ratioSignal(
  key: BalanceSignal['key'],
  label: string,
  numerator: number,
  denominator: number,
  typicalRange: string,
  low: number,
  high: number,
  explanation: string,
): BalanceSignal {
  const value = denominator > 0 ? round(numerator / denominator) : null;
  return {
    key,
    label,
    value,
    numerator: round(numerator),
    denominator: round(denominator),
    typicalRange,
    status: value == null ? 'no_data' : value < low || value > high ? 'watch' : 'balanced',
    explanation,
  };
}

export function computeBalance(audit: MuscleAudit[]): BalanceSignal[] {
  const push = sum(audit, ['chest_upper', 'chest_mid_lower', 'delts_front', 'triceps']);
  const pull = sum(audit, ['lats', 'upper_back', 'delts_rear', 'biceps']);
  const quads = sum(audit, ['quads']);
  const hamstrings = sum(audit, ['hamstrings']);
  const sideRear = sum(audit, ['delts_side', 'delts_rear']);
  const front = sum(audit, ['delts_front']);
  const upper = sum(audit, [
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
  ]);
  const lower = sum(audit, ['quads', 'hamstrings', 'glutes', 'calves']);
  const calves = sum(audit, ['calves']);
  return [
    ratioSignal(
      'push_pull',
      'Push : Pull',
      push,
      pull,
      '0.7–1.4',
      0.7,
      1.4,
      'A rough upper-body balance check for pressing volume versus back and rear-delt work.',
    ),
    ratioSignal(
      'quad_hamstring',
      'Quad : Hamstring',
      quads,
      hamstrings,
      '0.8–2.0',
      0.8,
      2,
      'Shows whether knee-dominant work is outpacing posterior-chain work.',
    ),
    ratioSignal(
      'delts',
      'Side + rear : Front delt',
      sideRear,
      front,
      '0.5+',
      0.5,
      Number.POSITIVE_INFINITY,
      'A shoulder-width check; pressing already supplies much of the front-delt stimulus.',
    ),
    ratioSignal(
      'upper_lower',
      'Upper : Lower',
      upper,
      lower,
      '0.8–2.5',
      0.8,
      2.5,
      'Compares total upper-body work with quad, hamstring, glute, and calf work.',
    ),
    {
      key: 'calves',
      label: 'Calves presence',
      value: calves,
      numerator: round(calves),
      denominator: 0,
      typicalRange: ' > 0 sets',
      status: calves === 0 ? 'watch' : 'balanced',
      explanation: 'Keeps a commonly missed lower-leg muscle visible in the audit.',
    },
  ];
}

export function computeAdherence(
  workoutDates: Array<{ id: string; performedAt: string }>,
  plannedSessions: number,
  now = new Date(),
): AdherenceWeek[] {
  const current = weekStart(now);
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(current);
    start.setUTCDate(start.getUTCDate() - (7 - index) * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const ids = new Set(
      workoutDates
        .filter((workout) => {
          const time = new Date(workout.performedAt).getTime();
          return time >= start.getTime() && time < end.getTime();
        })
        .map((workout) => workout.id),
    );
    const actualSessions = ids.size;
    return {
      weekStart: start.toISOString(),
      label: new Intl.DateTimeFormat('en-CA', {
        month: 'short',
        day: 'numeric',
      }).format(start),
      plannedSessions,
      actualSessions,
      adherencePct: plannedSessions
        ? Math.min(100, Math.round((actualSessions / plannedSessions) * 100))
        : 0,
    };
  });
}
