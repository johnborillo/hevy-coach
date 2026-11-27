import { describe, expect, it, vi } from 'vitest';

import {
  asksAboutRecentTraining,
  coachClock,
  relativeDayLabel,
  resolveRelativeDates,
} from '../lib/coach-clock';
import { buildCoachContext } from '../lib/coach-context';
import { freshenForRecentQuestion } from '../lib/coach-freshness';
import { collectEvidenceIssues } from '../lib/openrouter';
import type { CalendarWorkout, DashboardData } from '../lib/hevy';
import type { AthleteProfile, ChatMessage } from '../lib/storage';

// Friday 2026-11-27, 01:30 UTC = Thursday 2026-11-26, 20:30 in Toronto.
const NOW = new Date('2026-11-27T01:30:00.000Z');

const profile = {
  displayName: 'Athlete',
  weightUnit: 'lb',
  heightUnit: 'imperial',
  heightCm: null,
  weightKg: null,
  phase: 'maintain',
  phaseStartedAt: '',
  primaryGoal: 'Build muscle',
  experience: 'intermediate',
  daysPerWeek: 4,
  minutesPerSession: 60,
  limitations: '',
  preferences: '',
  timezone: 'America/Toronto',
} as unknown as AthleteProfile;

function workout(id: string, date: string, title: string): CalendarWorkout {
  return {
    id,
    title,
    date,
    time: '18:00',
    durationMinutes: 60,
    workingSets: 12,
    volumeKg: 5000,
    exercises: [
      {
        title: 'Bench Press (Barbell)',
        muscle: 'Chest',
        sets: [{ type: 'normal', weightKg: 100, reps: 5, rpe: 8 }],
      },
    ],
  } as unknown as CalendarWorkout;
}

function dashboardWith(workouts: CalendarWorkout[]) {
  return {
    calendarWorkouts: workouts,
    progressionStates: [],
    muscles: [],
    adherenceWeeks: [],
    weeklyReview: { label: '', wins: [], watch: [], nextSteps: [] },
    lastSyncAt: '2026-11-27T01:20:00.000Z',
  } as unknown as DashboardData;
}

function ask(content: string): ChatMessage[] {
  return [
    {
      id: 'm1',
      conversationId: 'c1',
      role: 'user',
      content,
      model: null,
      createdAt: NOW.toISOString(),
    } as ChatMessage,
  ];
}

describe('coach clock', () => {
  it('uses the athlete time zone for the local date, weekday and time', () => {
    expect(coachClock(NOW, 'America/Toronto')).toEqual({
      today: '2026-11-26',
      weekday: 'Thursday',
      localTime: '20:30',
      timeZone: 'America/Toronto',
    });
    expect(coachClock(NOW, 'UTC').today).toBe('2026-11-27');
    expect(coachClock(NOW, 'Not/AZone').timeZone).toBe('UTC');
  });

  it('labels workouts relative to today', () => {
    expect(relativeDayLabel('2026-11-26', '2026-11-26')).toBe('today');
    expect(relativeDayLabel('2026-11-25', '2026-11-26')).toBe('yesterday');
    expect(relativeDayLabel('2026-11-23', '2026-11-26')).toBe('3 days ago');
  });

  it('resolves relative wording into local dates', () => {
    const today = '2026-11-26'; // Thursday
    expect(resolveRelativeDates('How was my workout today?', today)).toEqual([today]);
    expect(resolveRelativeDates('how did I do last night', today)).toEqual(['2026-11-25']);
    expect(resolveRelativeDates("Monday's session felt heavy", today)).toEqual([
      '2026-11-23',
    ]);
    expect(resolveRelativeDates('compare to last Thursday', today)).toEqual([
      '2026-11-19',
    ]);
    expect(resolveRelativeDates('what about 4 days ago', today)).toEqual(['2026-11-22']);
    expect(resolveRelativeDates('how is this week going', today)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
    ]);
    expect(resolveRelativeDates('Why is my bench stalling?', today)).toEqual([]);
  });

  it('detects questions that need fresh Hevy data', () => {
    expect(asksAboutRecentTraining('How was my workout today?')).toBe(true);
    expect(asksAboutRecentTraining('I just finished legs')).toBe(true);
    expect(asksAboutRecentTraining('review my latest session')).toBe(true);
    expect(asksAboutRecentTraining('Why is my bench stalling?')).toBe(false);
  });
});

describe('coach context dates', () => {
  it('tells the coach today has no workout instead of leaving it to guess', () => {
    const dashboard = dashboardWith([
      workout('w-old', '2026-11-24', 'Push'),
      workout('w-older', '2026-11-22', 'Legs'),
    ]);
    const context = JSON.parse(
      buildCoachContext(profile, dashboard, ask('How was my workout today?'), {
        now: NOW,
      }).text,
    );
    expect(context.clock).toMatchObject({
      today: '2026-11-26',
      weekday: 'Thursday',
      localTime: '20:30',
      lastHevySyncAt: '2026-11-27T01:20:00.000Z',
      workoutLoggedToday: false,
      mostRecentWorkoutDate: '2026-11-24',
      daysSinceMostRecentWorkout: 2,
      datesReferencedInQuestion: [
        {
          date: '2026-11-26',
          weekday: 'Thursday',
          relativeDay: 'today',
          workoutsLogged: [],
        },
      ],
    });
    expect(context.verifiedHevyWorkoutLog[0]).toMatchObject({
      date: '2026-11-24',
      weekday: 'Tuesday',
      relativeDay: '2 days ago',
    });
  });

  it("pulls in an older workout the athlete names by weekday", () => {
    const dashboard = dashboardWith([
      workout('w4', '2026-11-26', 'Pull'),
      workout('w3', '2026-11-25', 'Push'),
      workout('w2', '2026-11-24', 'Legs'),
      workout('w1', '2026-11-16', 'Upper'),
    ]);
    const context = JSON.parse(
      buildCoachContext(profile, dashboard, ask('How did last Monday go?'), {
        now: NOW,
      }).text,
    );
    expect(context.clock.workoutLoggedToday).toBe(true);
    // Last Monday from Thursday 2026-11-26 is 2026-11-23: nothing logged.
    expect(context.clock.datesReferencedInQuestion).toEqual([
      expect.objectContaining({ date: '2026-11-23', workoutsLogged: [] }),
    ]);
    const today = JSON.parse(
      buildCoachContext(profile, dashboard, ask('compare to Monday the 16th, 10 days ago'), {
        now: NOW,
      }).text,
    );
    expect(
      today.verifiedHevyWorkoutLog.map((item: { id: string }) => item.id),
    ).toContain('w1');
  });

  it('lets the coach state today\'s date without failing evidence validation', () => {
    const dashboard = dashboardWith([workout('w-old', '2026-11-24', 'Push')]);
    const context = buildCoachContext(
      profile,
      dashboard,
      ask('How was my workout today?'),
      { now: NOW },
    );
    const answer =
      "I don't see a workout logged today (2026-11-26) yet. Your most recent session was Push on 2026-11-24, two days ago.";
    expect(collectEvidenceIssues(answer, dashboard, profile, context.text)).toEqual([]);
  });

  it('still rejects a claimed workout on a day with nothing logged', () => {
    const dashboard = dashboardWith([workout('w-old', '2026-11-24', 'Push')]);
    const context = buildCoachContext(
      profile,
      dashboard,
      ask('How was my workout today?'),
      { now: NOW },
    );
    const answer = 'Great work, you logged a strong session on 2026-11-26.';
    expect(
      collectEvidenceIssues(answer, dashboard, profile, context.text).map(
        (item) => item.kind,
      ),
    ).toEqual(['unsupported_date']);
  });
});

describe('freshness sync before recent questions', () => {
  const syncResult = (mode: 'delta' | 'none') => ({
    status: 'current' as const,
    mode,
    workoutCount: 10,
    nextPage: null,
    pageCount: null,
    lastSyncAt: NOW.toISOString(),
  });

  it('skips Hevy entirely for questions that are not about recent training', async () => {
    const sync = vi.fn();
    await expect(
      freshenForRecentQuestion('u1', 'Why is my bench stalling?', { apiKey: 'k', sync }),
    ).resolves.toBe('not_needed');
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs and refreshes analysis when Hevy has new data', async () => {
    const sync = vi.fn().mockResolvedValue(syncResult('delta'));
    const refresh = vi.fn().mockResolvedValue(null);
    await expect(
      freshenForRecentQuestion('u1', 'How was my workout today?', {
        apiKey: 'k',
        sync,
        refresh,
      }),
    ).resolves.toBe('synced');
    expect(refresh).toHaveBeenCalledWith('u1');
  });

  it('does not refresh analysis when the store is already current', async () => {
    const refresh = vi.fn();
    await expect(
      freshenForRecentQuestion('u1', 'How was my workout today?', {
        apiKey: 'k',
        sync: vi.fn().mockResolvedValue(syncResult('none')),
        refresh,
      }),
    ).resolves.toBe('current');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never blocks or breaks the answer when Hevy is slow or failing', async () => {
    await expect(
      freshenForRecentQuestion('u1', 'how was today', {
        apiKey: 'k',
        sync: () => new Promise(() => {}),
        timeoutMs: 20,
      }),
    ).resolves.toBe('timed_out');
    await expect(
      freshenForRecentQuestion('u1', 'how was today', {
        apiKey: 'k',
        sync: vi.fn().mockRejectedValue(new Error('Hevy 503')),
      }),
    ).resolves.toBe('failed');
  });
});
