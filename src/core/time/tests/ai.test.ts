import { expect, it } from 'vitest';
import { monthStart } from '../ai';
import { monthStarts } from '../../../../tests/fixtures/timezones';
it('ADMIN-B10 the monthly AI budget starts at the first local midnight of the month, daylight saving included', () => {
  for (const { timezone, now, start } of monthStarts)
    expect(monthStart(timezone, new Date(now)).toISOString()).toBe(start);
});
