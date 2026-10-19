import { expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { serialized, withSessionLock } from '../locks';
import { defaults } from '@/core/config/defaults';
it('ADMIN-B31 the restore lock admits one session at a time and is free again afterwards', async () => {
  const outer = await withSessionLock(defaults.restoreLock, () =>
    withSessionLock(defaults.restoreLock, async () => 'inner ran'),
  );
  expect(outer).toEqual({ acquired: true, value: { acquired: false } });
  expect(await withSessionLock(defaults.restoreLock, async () => 'free')).toEqual({
    acquired: true,
    value: 'free',
  });
});
it('ADMIN-B31 the restore lock is released when the work throws', async () => {
  await expect(
    withSessionLock(defaults.restoreLock, async () => {
      throw new Error('restore failed');
    }),
  ).rejects.toThrow('restore failed');
  expect(await withSessionLock(defaults.restoreLock, async () => 'free')).toMatchObject({
    acquired: true,
  });
});
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
