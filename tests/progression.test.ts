import { describe, expect, it } from 'vitest';
import {
  computeProgression,
  theilSen,
  type ProgressionSession,
} from '../lib/progression';
import type { ClassifiedSet } from '../lib/sets';

function set(loadKg: number, reps: number, rpe: number): ClassifiedSet {
  return {
    cls: 'working',
    countsAsWorking: 1,
    loadKg,
    reps,
    rpe,
    e1rmEligible: true,
    e1rmKg: loadKg * (1 + reps / 30),
    loadVolumeKg: loadKg * reps,
    repVolume: null,
  };
}

function sessions(
  values: Array<[number, number, number]>,
): ProgressionSession[] {
  return values.map(([load, reps, rpe], index) => ({
    performedAt: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    sets: [set(load, reps, rpe)],
  }));
}

describe('progression engine', () => {
  it('uses a robust slope that resists a single bad session', () => {
    expect(theilSen([100, 102, 80, 104, 106])).toBeCloseTo(1.417, 3);
  });

  it('requires four sessions before judging an exercise', () => {
    expect(
      computeProgression(
        'bench',
        'Bench Press',
        sessions([
          [60, 8, 8],
          [60, 9, 8.5],
          [60, 10, 9],
        ]),
      ),
    ).toMatchObject({ status: 'insufficient_data', recommendation: 'none' });
  });

  it('recommends load after progressing through the top of a rep range', () => {
    expect(
      computeProgression(
        'bench',
        'Bench Press',
        sessions([
          [60, 8, 8],
          [62.5, 8, 8],
          [62.5, 9, 8.5],
          [65, 10, 9],
        ]),
        { targetRepRange: [8, 10] },
      ),
    ).toMatchObject({ status: 'progressing', recommendation: 'add_load' });
  });

  it('detects rising effort without output improvement as a stall', () => {
    const state = computeProgression(
      'row',
      'Cable Row',
      sessions([
        [30, 10, 8],
        [30, 11, 8.5],
        [30, 11, 9],
        [30, 10, 9.5],
        [30, 10, 9.5],
      ]),
    );
    expect(state).toMatchObject({
      status: 'stalled',
      recommendation: 'reduce_load',
      sessionsSinceImprovement: 4,
    });
  });

  it('asks for effort data when stable performance cannot be interpreted', () => {
    const noRpe = sessions([
      [80, 8, 8],
      [80, 8, 8],
      [80, 8, 8],
      [80, 8, 8],
    ]).map((session) => ({
      ...session,
      sets: session.sets.map((item) => ({ ...item, rpe: null })),
    }));
    expect(computeProgression('bench', 'Bench Press', noRpe)).toMatchObject({
      status: 'holding',
      recommendation: 'log_rpe',
    });
  });

  it('does not call wave-loaded sessions a plateau', () => {
    expect(
      computeProgression(
        'squat',
        'Squat',
        sessions([
          [100, 6, 8],
          [105, 5, 8],
          [110, 4, 8.5],
          [115, 3, 9],
        ]),
      ).status,
    ).toBe('variable_load');
  });
});
