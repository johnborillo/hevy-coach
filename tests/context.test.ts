import { describe, expect, it } from 'vitest';
import { buildAthleteContext } from '../lib/context';
import type { AthleteProfile } from '../lib/storage';

describe('athlete context', () => {
  it('computes phase duration without changing the stored profile', () => {
    const profile: AthleteProfile = {
      displayName: 'Athlete',
      biologicalSex: 'prefer_not_to_say',
      age: null,
      heightCm: null,
      weightKg: null,
      weightUnit: 'lb',
      heightUnit: 'imperial',
      experience: 'intermediate',
      primaryGoal: 'Build muscle and strength',
      targetDate: '',
      daysPerWeek: 4,
      minutesPerSession: 60,
      equipment: 'Full gym',
      limitations: '',
      preferences: '',
      phase: 'cut',
      phaseStartedAt: '2026-08-24',
      dailyCalories: null,
      proteinGrams: null,
      sleepHoursTypical: null,
      dropsetWeight: 0.5,
      loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
      timezone: 'UTC',
    };
    const context = buildAthleteContext(
      profile,
      null,
      null,
      new Date('2026-09-21T12:00:00.000Z'),
    );

    expect(context.phase).toBe('cut');
    expect(context.phaseWeeks).toBe(4);
    expect(context.phaseStartedAt).toBe('2026-08-24');
  });
});
