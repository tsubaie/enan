'use client';
import { useSyncExternalStore } from 'react';
import { useFormatter, useNow, useTimeZone } from 'next-intl';
import { dayAt } from '@/core/time/tasks';
import { defaults } from '@/core/config/defaults';
// Every visible date and count goes through these hooks so numerals and the workspace timezone
// come from the request configuration (docs/05 § Internationalization). Plain dates are calendar
// values: they are rendered at UTC so the day never shifts, and never parsed with new Date(iso).
// A calendar day as a Date at UTC midnight, for formatting with `timeZone: 'UTC'`.
export function plainDateValue(day: string) {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}
export function usePlainDate() {
  const format = useFormatter();
  return (value: string) => format.dateTime(plainDateValue(value), 'day', { timeZone: 'UTC' });
}
// A calendar day with its weekday named in full ("Sunday, Oct 18, 2026"), for a page that opens on
// the day itself (HOME-B07).
export function useLongDate() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(plainDateValue(value), 'day', { timeZone: 'UTC', weekday: 'long' });
}
// A calendar day as its weekday and as its number, for a strip where the month is implied.
export function useWeekday() {
  const format = useFormatter();
  return (value: string) => format.dateTime(plainDateValue(value), 'weekday', { timeZone: 'UTC' });
}
export function useDayOfMonth() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(plainDateValue(value), 'dayOfMonth', { timeZone: 'UTC' });
}
export function useDateTime() {
  const format = useFormatter();
  return (value: string) => format.dateTime(new Date(value), 'dateTime');
}
// next-intl's relative time takes no named format, so the numbering system the request
// configuration chose (Arabic-Indic or Western) is read back from the integer format and passed on.
export function useNumberingSystem() {
  const format = useFormatter();
  return format.number(0, 'integer') === '0' ? 'latn' : 'arab';
}
// How far `value` is from `now` in words ("in 3 days", "4 weeks ago"), in the user's numerals.
export function useRelative() {
  const format = useFormatter();
  const numberingSystem = useNumberingSystem();
  return (value: Date, now: Date) => format.relativeTime(value, { now, numberingSystem });
}
// The clock every relative time and "today" reads. While hydrating it is the request's (the
// provider's `now`, src/core/i18n/request.ts), so the client's first render writes the server's
// text; a mismatch would make React throw the page's server markup away and render it again.
// Afterwards it is the device's, read again every half minute while anything shows it, because the
// root layout's `now` is not sent again on a client-side navigation.
let deviceNow = new Date();
const clockListeners = new Set<() => void>();
let ticking: ReturnType<typeof setInterval> | undefined;
function tick() {
  deviceNow = new Date();
  for (const listener of clockListeners) listener();
}
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!ticking) {
    tick();
    ticking = setInterval(tick, 30_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size) return;
    clearInterval(ticking);
    ticking = undefined;
  };
}
function useClock() {
  const requestNow = useNow();
  return useSyncExternalStore(
    subscribeClock,
    () => deviceNow,
    () => requestNow,
  );
}
// Relative wording for timestamps ("2 hours ago"); pair it with the absolute value in a title.
export function useRelativeTime() {
  const relative = useRelative();
  const now = useClock();
  return (value: string) => relative(new Date(value), now);
}
// Today's calendar day in the user's timezone (docs/05 § Internationalization).
export function useToday() {
  const now = useClock();
  const timeZone = useTimeZone() ?? defaults.timezone;
  return dayAt(timeZone, now.toISOString());
}
export function useCount() {
  const format = useFormatter();
  return (value: number) => format.number(value, 'integer');
}
// Measured quantities keep their decimals; percentages round to whole points and a change carries
// its sign, so a reader never has to infer direction from an arrow alone.
export function useDecimal() {
  const format = useFormatter();
  return (value: number) => format.number(value, 'decimal');
}
// A reporting month, named rather than numbered: "Sep 2026" reads at a glance where "2026-09" has
// to be decoded. The period index is 1-based, the way a KPI's periods are counted.
export function useMonthYear() {
  const format = useFormatter();
  return (year: number, month: number) =>
    format.dateTime(new Date(Date.UTC(year, month - 1, 1)), 'monthYear', { timeZone: 'UTC' });
}
// A month on its own, for a column header where the year is already said once.
export function useMonth() {
  const format = useFormatter();
  return (month: number) =>
    format.dateTime(new Date(Date.UTC(2000, month - 1, 1)), 'month', { timeZone: 'UTC' });
}
export function useYear() {
  const format = useFormatter();
  return (value: number) => format.number(value, 'year');
}
export function usePercent() {
  const format = useFormatter();
  return (value: number) => format.number(value, 'percent');
}
export function useSignedPercent() {
  const format = useFormatter();
  return (value: number) => format.number(value, 'signedPercent');
}
// How long ago a calendar day was, in words. A reading is dated to a day rather than an instant,
// so it is relativised at UTC midnight the way every other plain date is rendered.
export function useRelativeDay() {
  const relative = useRelative();
  const now = useClock();
  return (day: string) => relative(plainDateValue(day), now);
}
// Up to two initials from a display name; works for Arabic and Latin names (PEOPLE-A06).
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}
