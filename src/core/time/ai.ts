import { dayAt, dayValue } from './days';
// The wall-clock time `instant` shows in `timezone`, read as if it were UTC.
function wallClock(timezone: string, instant: number) {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}
// The instant the current month began in `timezone`: its first local midnight. Each pass moves by
// the zone's offset there; the second catches a daylight-saving change between the two readings.
export function monthStart(timezone: string, now = new Date()) {
  return dayStart(timezone, `${dayAt(timezone, now.toISOString()).slice(0, 8)}01`);
}
// The instant `day` began in `timezone`: its local midnight, found the same way.
export function dayStart(timezone: string, day: string) {
  const midnight = dayValue(day);
  let instant = midnight;
  for (let pass = 0; pass < 2; pass++) instant -= wallClock(timezone, instant) - midnight;
  return new Date(instant);
}

export function retryDelay(value: string | null | undefined) {
  if (!value) return 30000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? Math.max(0, instant - Date.now()) : 30000;
}
