import { describe, expect, it } from 'vitest';
import {
  computeProgression,
  type ProgressionSession,
} from '../lib/progression';
import type { ClassifiedSet } from '../lib/sets';

function compoundSet(
  loadKg: number,
  reps: number,
  rpe: number | null,
): ClassifiedSet {
  const eligible = reps >= 1 && reps <= 8;
  return {
    cls: 'working',
    countsAsWorking: 1,
    loadKg,
    reps,
    rpe,
    e1rmEligible: eligible,
    e1rmKg: eligible ? loadKg * (1 + reps / 30) : null,
    loadVolumeKg: loadKg * reps,
    repVolume: null,
  };
}

function isolationSet(
  loadKg: number,
  reps: number,
  rpe: number | null,
): ClassifiedSet {
  return {
    cls: 'working',
    countsAsWorking: 1,
    loadKg,
    reps,
    rpe,
    e1rmEligible: false,
    e1rmKg: null,
    loadVolumeKg: loadKg * reps,
    repVolume: null,
  };
}

function sessions(
  values: Array<[number, number, number | null]>,
  make: typeof compoundSet = compoundSet,
): ProgressionSession[] {
  return values.map(([load, reps, rpe], index) => ({
    performedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    exerciseTemplateId: 'tpl',
    sets: [make(load, reps, rpe)],
  }));
}

function spread(values: number[]) {
  const positive = values.filter((value) => value > 0);
  return Math.max(...positive) / Math.min(...positive);
}

describe('progression engine — regressions', () => {
  it('uses one continuous performance metric for a compound with mixed rep counts', () => {
    const state = computeProgression(
      'bench',
      'Bench Press (Barbell)',
      sessions([
        [80, 6, 8],
        [80, 10, 8],
        [82.5, 6, 8],
        [82.5, 10, 8.5],
        [85, 6, 8],
        [85, 10, 8.5],
      ]),
    );
    expect(spread(state.performanceIndex)).toBeLessThan(1.5);
    expect(state.status).not.toBe('regressing');
    expect(state.status).not.toBe('variable_load');
    expect(['progressing', 'holding']).toContain(state.status);
  });

  it('does not report a false improvement when rep count crosses the e1RM gate at a fixed load', () => {
    const state = computeProgression(
      'bench',
      'Bench Press (Barbell)',
      sessions([
        [80, 6, 8],
        [80, 10, 8],
        [80, 6, 8],
        [80, 10, 8],
        [80, 6, 8],
        [80, 10, 8],
      ]),
    );
    expect(spread(state.performanceIndex)).toBeLessThan(1.5);
    expect(state.status).toBe('holding');
    expect(state.sessionsSinceImprovement).toBeGreaterThanOrEqual(5);
  });

  it('keeps load × reps as the metric for isolation work across all sessions', () => {
    const state = computeProgression(
      'lateral',
      'Lateral Raise (Dumbbell)',
      sessions(
        [
          [10, 12, 8],
          [10, 13, 8],
          [10, 14, 8.5],
          [10, 15, 8.5],
          [12, 12, 8.5],
        ],
        isolationSet,
      ),
    );
    expect(spread(state.performanceIndex)).toBeLessThan(1.5);
    expect(state.status).toBe('progressing');
  });

  it('calls a long flat run a stall even when no RPE was logged', () => {
    const state = computeProgression(
      'incline',
      'Incline Bench Press (Dumbbell)',
      sessions([
        [30, 10, null],
        [30, 11, null],
        [30, 10, null],
        [30, 10, null],
        [30, 11, null],
        [30, 10, null],
        [30, 10, null],
        [30, 10, null],
      ]),
    );
    expect(state.rpeCoverage).toBe(0);
    expect(state.status).toBe('stalled');
    expect(state.recommendation).toBe('swap_or_rotate');
    expect(state.rationale).toMatch(/effort|RPE/i);
  });

  it('still prefers log_rpe for a short flat run without effort data', () => {
    const state = computeProgression(
      'incline',
      'Incline Bench Press (Dumbbell)',
      sessions([
        [30, 10, null],
        [30, 11, null],
        [30, 10, null],
        [30, 10, null],
      ]),
    );
    expect(state.status).toBe('holding');
    expect(state.recommendation).toBe('log_rpe');
  });
});
