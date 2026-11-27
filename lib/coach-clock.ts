// Date awareness for the coach: the athlete's local "now", relative day
// labels for logged workouts, and resolution of phrases like "today",
// "yesterday", "on Monday" or "last week" into concrete YYYY-MM-DD dates.
// Workout dates are already stored in the athlete's time zone, so every
// comparison here happens on local calendar dates, never on UTC instants.

const DAY_MS = 86_400_000;

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type CoachClock = {
  today: string;
  weekday: (typeof WEEKDAYS)[number];
  localTime: string;
  timeZone: string;
};

function safeTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function coachClock(
  now: Date,
  timeZone: string | null | undefined,
): CoachClock {
  const zone = safeTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    today,
    weekday: weekdayOf(today),
    localTime: `${parts.hour}:${parts.minute}`,
    timeZone: zone,
  };
}

function dateMs(isoDate: string) {
  return Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  );
}

export function addDays(isoDate: string, days: number) {
  return new Date(dateMs(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromDate: string, toDate: string) {
  return Math.round((dateMs(toDate) - dateMs(fromDate)) / DAY_MS);
}

export function weekdayOf(isoDate: string) {
  return WEEKDAYS[new Date(dateMs(isoDate)).getUTCDay()];
}

export function relativeDayLabel(workoutDate: string, today: string) {
  const days = daysBetween(workoutDate, today);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 1) return `${days} days ago`;
  return 'future date';
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
  return dates;
}

/** Monday-based week start, matching the weekly review. */
function weekStart(isoDate: string) {
  const offset = (new Date(dateMs(isoDate)).getUTCDay() + 6) % 7;
  return addDays(isoDate, -offset);
}

/**
 * Concrete local dates the athlete's message refers to with relative words.
 * Explicit YYYY-MM-DD dates are handled separately by the caller.
 */
export function resolveRelativeDates(question: string, today: string) {
  const text = question.toLowerCase();
  const dates = new Set<string>();
  if (
    /\b(today|tonight|this (morning|afternoon|evening))\b/.test(text)
  ) {
    dates.add(today);
  }
  if (/\b(yesterday|last night)\b/.test(text)) dates.add(addDays(today, -1));
  if (/\bday before yesterday\b/.test(text)) dates.add(addDays(today, -2));
  for (const match of text.matchAll(/\b(\d{1,2}) days? ago\b/g)) {
    const days = Number(match[1]);
    if (days > 0 && days <= 60) dates.add(addDays(today, -days));
  }
  const todayIndex = new Date(dateMs(today)).getUTCDay();
  WEEKDAYS.forEach((name, index) => {
    const pattern = new RegExp(`\\b(last |this past |on )?${name.toLowerCase()}('s)?\\b`);
    const match = text.match(pattern);
    if (!match) return;
    let back = (todayIndex - index + 7) % 7;
    // "last Thursday" said on a Thursday means a week ago, not today.
    if (back === 0 && match[1]?.trim() === 'last') back = 7;
    dates.add(addDays(today, -back));
  });
  if (/\bthis week\b/.test(text)) {
    for (const day of dateRange(weekStart(today), today)) dates.add(day);
  }
  if (/\blast week\b/.test(text)) {
    const start = addDays(weekStart(today), -7);
    for (const day of dateRange(start, addDays(start, 6))) dates.add(day);
  }
  return [...dates].sort();
}

/** Questions where a stale sync would make the answer wrong. */
export function asksAboutRecentTraining(question: string) {
  return /\b(today|tonight|this (morning|afternoon|evening)|yesterday|last night|just (did|finished|trained|lifted|logged|wrapped)|latest|most recent|last (workout|session|lift|training))\b/i.test(
    question,
  );
}
