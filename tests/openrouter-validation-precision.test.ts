import { describe, expect, it } from 'vitest';

import {
  collectEvidenceIssues,
  validateCoachEvidence,
} from '../lib/openrouter';
import type { DashboardData } from '../lib/hevy';
import type { AthleteProfile } from '../lib/storage';

const profile: AthleteProfile = {
  displayName: 'Athlete',
  biologicalSex: 'prefer_not_to_say',
  age: null,
  heightCm: null,
  weightKg: null,
  weightUnit: 'lb',
  heightUnit: 'imperial',
  experience: 'intermediate',
  primaryGoal: 'Build muscle',
  targetDate: '',
  daysPerWeek: 4,
  minutesPerSession: 60,
  equipment: 'Full gym',
  limitations: '',
  preferences: '',
  phase: 'maintain',
  phaseStartedAt: '',
  dailyCalories: null,
  proteinGrams: null,
  sleepHoursTypical: null,
  dropsetWeight: 0.5,
  loadIncrements: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5 },
  timezone: 'UTC',
};

const dashboard = {
  calendarWorkouts: [],
} as unknown as DashboardData;

describe('precise evidence validation', () => {
  it('does not flag guidance numbers or a rounded cited body-weight value', () => {
    const content =
      'Start with a modest surplus—roughly **150–250 calories per day**. Aim for about **0.4–0.5 lb per week** on average. Your recent 7-day average is **181 lb**. [Hevy summary: bodyWeightTrend] Get roughly **130–180 g of protein daily**.';
    const evidence =
      '{"athlete":{"bodyWeightTrend":{"average7d":"181.3 lb"}},"muscleAudit":[]}';
    expect(
      collectEvidenceIssues(content, dashboard, profile, evidence),
    ).toEqual([]);
  });

  it('reports an unsupported number in a cited claim as a soft issue', () => {
    const issues = collectEvidenceIssues(
      'Your recent 7-day average is 190 lb. [Hevy summary: bodyWeightTrend]',
      dashboard,
      profile,
      '{"athlete":{"bodyWeightTrend":{"average7d":"181.3 lb"}}}',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'unsupported_number',
      severity: 'soft',
      tokens: ['190'],
    });
  });

  it('allows conventionally kilogram-labelled equipment for a lb athlete', () => {
    expect(
      collectEvidenceIssues(
        'Use two 20 kg plates per side.',
        dashboard,
        profile,
      ),
    ).not.toContainEqual(expect.objectContaining({ kind: 'wrong_unit' }));
    expect(
      collectEvidenceIssues('Your bench is 100 kg.', dashboard, profile),
    ).toContainEqual(expect.objectContaining({ kind: 'wrong_unit' }));
  });

  it('only checks centimetres when a height number is attached', () => {
    expect(
      collectEvidenceIssues(
        'Measure your waist in cm or inches.',
        dashboard,
        profile,
      ),
    ).not.toContainEqual(expect.objectContaining({ kind: 'wrong_unit' }));
    expect(
      collectEvidenceIssues('You are 180 cm tall.', dashboard, profile),
    ).toContainEqual(expect.objectContaining({ kind: 'wrong_unit' }));
  });

  it('keeps the legacy throwing wrapper semantics', () => {
    expect(() =>
      validateCoachEvidence('Your bench is 100 kg.', dashboard, profile),
    ).toThrow();
  });
});
