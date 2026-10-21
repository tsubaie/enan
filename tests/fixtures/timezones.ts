// Midnight boundaries in two zones, including a DST transition (docs/08 § Test data and clocks).
export const midnightBoundaries = [
  { timezone: 'Asia/Riyadh', before: '2026-09-07T20:59:59Z', after: '2026-09-07T21:00:00Z' },
  { timezone: 'America/New_York', before: '2026-03-08T04:59:59Z', after: '2026-03-08T05:00:00Z' },
];
// Furthest offsets either side of UTC; a calendar date must render identically under both.
export const extremeZones = { east: 'Pacific/Kiritimati', west: 'Pacific/Pago_Pago' };
// The month a budget runs in, read at an instant: where it began in each zone (ADMIN-B10). New York
// begins November under summer time, the day it ends; Kolkata is a half-hour offset.
export const monthStarts = [
  { timezone: 'Asia/Riyadh', now: '2026-10-21T12:00:00Z', start: '2026-09-30T21:00:00.000Z' },
  { timezone: 'Asia/Riyadh', now: '2026-09-30T20:59:59Z', start: '2026-08-31T21:00:00.000Z' },
  { timezone: 'America/New_York', now: '2026-11-15T12:00:00Z', start: '2026-11-01T04:00:00.000Z' },
  { timezone: 'Asia/Kolkata', now: '2026-01-10T00:00:00Z', start: '2025-12-31T18:30:00.000Z' },
  { timezone: 'UTC', now: '2026-03-31T23:59:59Z', start: '2026-03-01T00:00:00.000Z' },
];
