import { describe, expect, it } from 'vitest';
import { summarizeBodyWeight, type BodyWeightPoint } from '../lib/body-weight';

describe('body-weight context', () => {
  it('exposes a rolling average and a four-week kg-per-week slope', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');
    const points: BodyWeightPoint[] = [
      {
        id: 'old',
        measuredAt: '2026-08-20T12:00:00.000Z',
        weightKg: 84,
        source: 'manual',
      },
      {
        id: 'a',
        measuredAt: '2026-09-15T12:00:00.000Z',
        weightKg: 82.4,
        source: 'hevy',
      },
      {
        id: 'b',
        measuredAt: '2026-09-20T12:00:00.000Z',
        weightKg: 82,
        source: 'hevy',
      },
    ];

    expect(summarizeBodyWeight(points, now)).toEqual({
      average7d: 82.2,
      slopeKgPerWeek: -0.56,
      latest: 82,
    });
  });

  it('does not let future-dated entries distort the current summary', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');
    const points: BodyWeightPoint[] = [
      {
        id: 'today',
        measuredAt: '2026-09-21T08:00:00.000Z',
        weightKg: 80,
        source: 'manual',
      },
      {
        id: 'future',
        measuredAt: '2026-09-22T08:00:00.000Z',
        weightKg: 100,
        source: 'manual',
      },
    ];

    expect(summarizeBodyWeight(points, now)).toMatchObject({
      average7d: 80,
      latest: 80,
    });
  });
});
