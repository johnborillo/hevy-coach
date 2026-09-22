type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function safeTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return 'UTC';
  }
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function offsetAt(instant: Date, timeZone: string) {
  const parts = localParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(instant.getTime() / 1_000) * 1_000;
}

function localDateTimeToInstant(
  parts: Pick<LocalParts, 'year' | 'month' | 'day'> &
    Partial<Pick<LocalParts, 'hour' | 'minute' | 'second'>>,
  timeZone: string,
) {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = target - offsetAt(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

function shiftedLocalDate(instant: Date, days: number, timeZone: string) {
  const parts = localParts(instant, timeZone);
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function localDayKey(instant: Date, timeZone: string) {
  const parts = localParts(instant, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function localDayStart(instant: Date, timeZone: string) {
  const { year, month, day } = localParts(instant, timeZone);
  return localDateTimeToInstant({ year, month, day }, timeZone);
}

export function shiftLocalDays(instant: Date, days: number, timeZone: string) {
  return localDateTimeToInstant(
    shiftedLocalDate(instant, days, timeZone),
    timeZone,
  );
}

export function localMondayStart(instant: Date, timeZone: string): Date {
  const parts = localParts(instant, timeZone);
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return localDateTimeToInstant(
    shiftedLocalDate(instant, -daysFromMonday, timeZone),
    timeZone,
  );
}

export function localWindowStart(now: Date, days: number, timeZone: string) {
  return shiftLocalDays(localDayStart(now, timeZone), -(days - 1), timeZone);
}
