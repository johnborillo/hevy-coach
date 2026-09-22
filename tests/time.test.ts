import { describe, expect, it } from 'vitest';
import { analyzeWorkoutHistory } from '../lib/hevy';
import { computeAdherence } from '../lib/audit';
import { localDayKey, localMondayStart } from '../lib/time';

const sundayNight = new Date('2026-09-21T01:00:00.000Z');

describe('athlete-local time boundaries', () => {
  it('places a Toronto Sunday night in the prior local week', () => {
    expect(localDayKey(sundayNight, 'America/Toronto')).toBe('2026-09-20');
    expect(localMondayStart(sundayNight, 'America/Toronto').toISOString()).toBe(
      '2026-09-14T04:00:00.000Z',
    );
  });

  it('places the same instant on Monday under UTC', () => {
    expect(localDayKey(sundayNight, 'UTC')).toBe('2026-09-21');
    expect(localMondayStart(sundayNight, 'UTC').toISOString()).toBe(
      '2026-09-21T00:00:00.000Z',
    );
  });

  it('uses the athlete-local date in calendar workouts', () => {
    const dashboard = analyzeWorkoutHistory(
      [
        {
          id: 'sunday-session',
          title: 'Upper',
          start_time: sundayNight.toISOString(),
          end_time: '2026-09-21T02:00:00.000Z',
          exercises: [],
        },
      ],
      [],
      'Athlete',
      new Date('2026-09-21T02:30:00.000Z'),
      [],
      [],
      4,
      'maintain',
      null,
      'America/Toronto',
    );
    expect(dashboard.calendarWorkouts[0].date).toBe('2026-09-20');
  });

  it('counts the Sunday-night session in the closed Toronto week', () => {
    const workouts = [
      { id: 'sunday-session', performedAt: sundayNight.toISOString() },
    ];
    const now = new Date('2026-09-21T16:00:00.000Z');
    const toronto = computeAdherence(workouts, 4, now, 'America/Toronto');
    const utc = computeAdherence(workouts, 4, now, 'UTC');

    expect(toronto.at(-2)?.actualSessions).toBe(1);
    expect(toronto.at(-1)?.actualSessions).toBe(0);
    expect(utc.at(-1)?.actualSessions).toBe(1);
  });
});
