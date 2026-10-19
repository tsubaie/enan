import { it, expect, vi } from 'vitest';
import { createSaveQueue } from '../save-queue';
import { ApiError } from '@/core/http/client';
const entity = { id: 'sample', revision: 1, deletedAt: null, deletedOpId: null, title: 'Initial' };
it('EP-B08 TASKS-A09 queued fields survive conflict and explicit reapply uses latest revision and a new key', async () => {
  const writer = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('conflict', 'Conflict', {}, 'request'))
    .mockResolvedValue({ ...entity, revision: 3, title: 'Mine' });
  const queue = createSaveQueue<typeof entity, { title: string }>(writer, vi.fn());
  queue.save(entity, { title: 'Mine' });
  expect(await queue.settle()).toBe(false);
  await queue.retry(async () => ({ ...entity, revision: 2 }));
  expect(await queue.settle()).toBe(true);
  expect(writer.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  expect(writer.mock.calls[0]?.[3]).not.toBe(writer.mock.calls[1]?.[3]);
  expect(writer.mock.calls[1]?.[2]).toEqual({ title: 'Mine' });
});
it('EP-B08 pending edits drain after the active save using its returned revision', async () => {
  let resolve: (value: typeof entity) => void = () => {
    throw new Error('Not initialized');
  };
  const writer = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<typeof entity>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ ...entity, revision: 3, title: 'Second' });
  const queue = createSaveQueue<typeof entity, { title: string }>(writer, vi.fn());
  queue.save(entity, { title: 'First' });
  queue.save(entity, { title: 'Second' });
  expect(writer).toHaveBeenCalledTimes(1);
  resolve({ ...entity, revision: 2, title: 'First' });
  expect(await queue.settle()).toBe(true);
  expect(writer.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  expect(queue.latest()?.revision).toBe(3);
});
// EP-A04: edits typed faster than the network answers must never race each other. Whatever is
// queued while a request is in flight is one request afterwards, carrying the merged draft against
// the revision the first one returned, so two requests never cross and the second never carries
// a revision older than the first's answer.
it('EP-A04 three rapid edits make two ordered requests, the second merged and on the returned revision', async () => {
  let resolve: (value: typeof entity) => void = () => {
    throw new Error('Not initialized');
  };
  const writer = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<typeof entity>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ ...entity, revision: 3, title: 'Third' });
  const states: string[] = [];
  const queue = createSaveQueue<typeof entity, { title?: string; note?: string }>(writer, (state) =>
    states.push(state),
  );
  queue.save(entity, { title: 'First' });
  queue.save(entity, { title: 'Second' });
  queue.save(entity, { note: 'Aside' });
  queue.save(entity, { title: 'Third' });
  // Nothing leaves while the first request is out; the three edits wait as one draft.
  expect(writer).toHaveBeenCalledTimes(1);
  resolve({ ...entity, revision: 2, title: 'First' });
  expect(await queue.settle()).toBe(true);
  expect(writer).toHaveBeenCalledTimes(2);
  expect(writer.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  expect(writer.mock.calls[1]?.[2]).toEqual({ title: 'Third', note: 'Aside' });
  // Each request is its own idempotent operation.
  expect(writer.mock.calls[0]?.[3]).not.toBe(writer.mock.calls[1]?.[3]);
  expect(states).toEqual(['saving', 'saved', 'saving', 'saved']);
});
it('EP-A04 a 409 keeps the draft, sends nothing more on its own, and reapply carries the whole draft on the reloaded revision', async () => {
  const writer = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('conflict', 'Conflict', {}, 'request-409'))
    .mockResolvedValue({ ...entity, revision: 6, title: 'Mine', note: 'Later' });
  const notify = vi.fn();
  const queue = createSaveQueue<typeof entity, { title?: string; note?: string }>(writer, notify);
  queue.save(entity, { title: 'Mine' });
  expect(await queue.settle()).toBe(false);
  expect(notify).toHaveBeenLastCalledWith('conflict', expect.any(ApiError));
  // An edit typed after the conflict joins the kept draft instead of being sent against a
  // revision the server has already refused.
  queue.save(entity, { note: 'Later' });
  expect(writer).toHaveBeenCalledTimes(1);
  expect(await queue.settle()).toBe(false);
  await queue.retry(async () => ({ ...entity, revision: 5, title: 'Theirs' }));
  expect(await queue.settle()).toBe(true);
  expect(writer).toHaveBeenCalledTimes(2);
  expect(writer.mock.calls[1]?.[1]).toBe(5);
  expect(writer.mock.calls[1]?.[2]).toEqual({ title: 'Mine', note: 'Later' });
  expect(notify).toHaveBeenLastCalledWith('saved', null);
  expect(queue.latest()?.revision).toBe(6);
});
it('EP-A04 discarding a conflicted draft returns to idle and sends nothing', async () => {
  const writer = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('conflict', 'Conflict', {}, 'request-409'));
  const notify = vi.fn();
  const queue = createSaveQueue<typeof entity, { title: string }>(writer, notify);
  queue.save(entity, { title: 'Mine' });
  expect(await queue.settle()).toBe(false);
  queue.discard();
  expect(notify).toHaveBeenLastCalledWith('idle', null);
  expect(await queue.settle()).toBe(true);
  expect(writer).toHaveBeenCalledTimes(1);
});
