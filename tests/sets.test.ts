import { describe, expect, it } from 'vitest';
import { classifySet } from '../lib/sets';

describe('classifySet', () => {
  it('excludes warm-ups and weights dropsets as half a working set', () => {
    expect(
      classifySet(
        { type: 'warmup', weight_kg: 40, reps: 8 },
        { title: 'Bench Press', equipment: 'barbell' },
      ),
    ).toMatchObject({ cls: 'warmup', countsAsWorking: 0, e1rmKg: null });
    expect(
      classifySet(
        { type: 'dropset', weight_kg: 60, reps: 10 },
        { title: 'Bench Press', equipment: 'barbell' },
      ),
    ).toMatchObject({
      cls: 'dropset',
      countsAsWorking: 0.5,
      loadVolumeKg: 300,
      e1rmKg: null,
    });
  });

  it('treats failure as RPE 10 when effort is omitted', () => {
    expect(
      classifySet(
        { type: 'failure', weight_kg: 100, reps: 5 },
        {
          title: 'Squat (Barbell)',
          equipment: 'barbell',
          primary_muscle_group: 'quadriceps',
        },
      ),
    ).toMatchObject({
      cls: 'failure',
      countsAsWorking: 1,
      rpe: 10,
      e1rmEligible: true,
    });
  });

  it('keeps high-rep compounds in volume but out of estimated strength', () => {
    expect(
      classifySet(
        { type: 'normal', weight_kg: 80, reps: 12 },
        {
          title: 'Bench Press (Barbell)',
          equipment: 'barbell',
          primary_muscle_group: 'chest',
        },
      ),
    ).toMatchObject({
      countsAsWorking: 1,
      loadVolumeKg: 960,
      e1rmEligible: false,
      e1rmKg: null,
    });
  });

  it('never promotes isolation work to an e1RM signal', () => {
    expect(
      classifySet(
        { type: 'normal', weight_kg: 12, reps: 8 },
        {
          title: 'Cable Lateral Raise',
          equipment: 'cable',
          primary_muscle_group: 'shoulders',
        },
      ).e1rmEligible,
    ).toBe(false);
  });

  it('uses body weight for pull-ups without mixing them into load-volume', () => {
    expect(
      classifySet(
        { type: 'normal', weight_kg: 0, reps: 8 },
        {
          title: 'Pull Up',
          equipment: 'bodyweight',
          primary_muscle_group: 'lats',
        },
        { bodyweightKg: 82.4 },
      ),
    ).toMatchObject({
      countsAsWorking: 1,
      loadKg: 82.4,
      repVolume: 8,
      loadVolumeKg: null,
      e1rmEligible: true,
    });
  });

  it('inverts assisted load and excludes it from e1RM', () => {
    expect(
      classifySet(
        { type: 'normal', weight_kg: 20, reps: 8 },
        { title: 'Pull Up (Assisted)', equipment: 'assisted' },
        { bodyweightKg: 80 },
      ),
    ).toMatchObject({
      loadKg: 60,
      e1rmEligible: false,
      loadVolumeKg: null,
    });
  });

  it('recognizes timed and distance work without treating it as a lifting set', () => {
    expect(
      classifySet(
        { duration_seconds: 600 },
        { title: 'Plank', equipment: 'bodyweight' },
      ).cls,
    ).toBe('timed');
    expect(
      classifySet(
        { distance_meters: 2_000, duration_seconds: 600 },
        { title: 'Rowing Machine', equipment: 'machine' },
      ),
    ).toMatchObject({ cls: 'distance', countsAsWorking: 0 });
  });
});
