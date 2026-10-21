import { expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { serialized } from '../locks';
import { defaults } from '@/core/config/defaults';
it('the migration lock queues concurrent callers instead of refusing them, in order', async () => {
  const order: string[] = [];
  const step = (name: string, wait: number) =>
    serialized(defaults.migrationLock, async () => {
      order.push(`${name}:start`);
      await sleep(wait);
      order.push(`${name}:end`);
      return name;
    });
  const results = await Promise.all([step('a', 30), step('b', 5), step('c', 1)]);
  expect(results).toEqual(['a', 'b', 'c']);
  expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  await expect(
    serialized(defaults.migrationLock, async () => {
      throw new Error('failed migration');
    }),
  ).rejects.toThrow('failed migration');
  expect(await serialized(defaults.migrationLock, async () => 'free')).toBe('free');
});
