import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRunner } from '../runner';
import { shutdownHandler } from '../shutdown';
import { DatabaseBusyError } from '@/core/db/client';
import { AiPayload } from '@/core/ai/job-schema';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
const repo = vi.hoisted(() => ({
  claim: vi.fn(),
  renew: vi.fn(),
  publish: vi.fn(),
  fail: vi.fn(),
  requestedCancellations: vi.fn(),
}));
const handler = vi.hoisted(() => ({
  concurrency: 1,
  schema: { parse: (value: object) => value },
  run: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('@/core/db/jobs-repo', () => repo);
vi.mock('../registry', () => ({ jobKinds: ['system.backup'], handlerFor: () => handler }));
vi.mock('../scheduler', () => ({ scheduleDue: vi.fn(async () => {}) }));
const maintenance = vi.hoisted(() => ({ restoring: false }));
vi.mock('@/core/backup/maintenance', () => ({ isRestoring: async () => maintenance.restoring }));
vi.mock('@/core/db/ids', () => ({ id: () => 'owner' }));
const notify = vi.hoisted(() => ({ emitUnattended: vi.fn(async () => 1) }));
vi.mock('@/core/notifications/emit', () => notify);
vi.mock('@/core/config/env', () => ({
  env: () => ({ JOBS_CONCURRENCY: 4, JOBS_DRAIN_SECONDS: 2 }),
}));
vi.mock('@/core/config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const job = { id: 'job-1', kind: 'system.backup', payload: {}, attempt: 1 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  maintenance.restoring = false;
  repo.requestedCancellations.mockResolvedValue([]);
  repo.claim.mockResolvedValueOnce(job).mockResolvedValue(null);
  repo.publish.mockResolvedValue(undefined);
  repo.fail.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve: (value: object) => void = () => {};
  const promise = new Promise<object>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function abortable(_job: object, signal: AbortSignal) {
  return new Promise((_resolve, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason)),
  );
}
describe('runner drain', () => {
  it('ADMIN-B33 stop stops claiming and lets a running handler finish within the drain window', async () => {
    const work = deferred();
    let signal: AbortSignal | undefined;
    handler.run.mockImplementation((_job: object, s: AbortSignal) => {
      signal = s;
      return work.promise;
    });
    const stop = startRunner();
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler.run).toHaveBeenCalledTimes(1);
    const stopped = stop();
    const claims = repo.claim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1500);
    expect(repo.claim.mock.calls.length).toBe(claims);
    work.resolve({ completed: true });
    await stopped;
    expect(repo.publish).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    expect(repo.fail).not.toHaveBeenCalled();
  });
  it.each(['system.backup', 'ai.tasks.breakdown'])(
    'ADMIN-B33 a %s handler still running after JOBS_DRAIN_SECONDS is aborted and its attempt retried',
    async (kind) => {
      const running = { ...job, kind };
      repo.claim.mockReset().mockResolvedValueOnce(running).mockResolvedValue(null);
      handler.run.mockImplementation(abortable);
      const stop = startRunner();
      await vi.advanceTimersByTimeAsync(1000);
      const stopped = stop();
      await vi.advanceTimersByTimeAsync(1999);
      expect(repo.fail).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await stopped;
      expect(repo.fail).toHaveBeenCalledWith(
        running,
        'shutdown',
        true,
        undefined,
        expect.any(Function),
      );
      expect(repo.publish).not.toHaveBeenCalled();
    },
  );
  it('ADMIN-B33 a cancelled AI job is not mistaken for a shutdown interruption', async () => {
    const running = { ...job, kind: 'ai.tasks.breakdown' };
    repo.claim.mockReset().mockResolvedValueOnce(running).mockResolvedValue(null);
    repo.requestedCancellations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: running.id }])
      .mockResolvedValue([]);
    handler.run.mockImplementation(abortable);
    const stop = startRunner();
    await vi.advanceTimersByTimeAsync(2000);
    expect(repo.fail).toHaveBeenCalledWith(
      running,
      'provider',
      false,
      undefined,
      expect.any(Function),
    );
    await stop();
  });
  it('ADR 0029 a heartbeat that waited out the write lock keeps the job; a lost lease aborts it', async () => {
    let signal: AbortSignal | undefined;
    const work = deferred();
    handler.run.mockImplementation((_job: object, s: AbortSignal) => {
      signal = s;
      return work.promise;
    });
    repo.renew.mockRejectedValueOnce(new DatabaseBusyError(10_000)).mockResolvedValueOnce(false);
    const stop = startRunner();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal?.aborted).toBe(true);
    work.resolve({ completed: true });
    await stop();
  });
  it('ADMIN-B13 nothing is claimed while a restore runs, and claiming resumes after it', async () => {
    maintenance.restoring = true;
    handler.run.mockResolvedValue({ completed: true });
    const stop = startRunner();
    await vi.advanceTimersByTimeAsync(3000);
    expect(repo.claim).not.toHaveBeenCalled();
    maintenance.restoring = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.claim).toHaveBeenCalled();
    await stop();
  });
  it('NOTIF-B04 an AI job tells whoever asked when it succeeds or fails; a system job tells no one', async () => {
    const entityId = '00000000-0000-7000-8000-000000000009';
    const asked = {
      ...job,
      kind: 'ai.notes.refine',
      createdBy: 'reader-1',
      payload: AiPayload.parse({
        capability: 'notes.refine',
        entityId,
        revision: 1,
        input: {},
        model: fixtureModel,
        locale: 'en',
        capabilityVersion: 1,
        promptVersion: 1,
        contentHash: 'fixture',
        maxOutputTokens: 4096,
        reservedTokens: 10000,
      }),
    };
    const effectOf = async (claimed: object, outcome: 'publish' | 'fail') => {
      repo.claim.mockReset().mockResolvedValueOnce(claimed).mockResolvedValue(null);
      handler.run.mockReset();
      if (outcome === 'publish') handler.run.mockResolvedValue({ completed: true });
      else handler.run.mockRejectedValue(new Error('provider down'));
      const stop = startRunner();
      await vi.advanceTimersByTimeAsync(1000);
      await stop();
      const calls = outcome === 'publish' ? repo.publish.mock.calls : repo.fail.mock.calls;
      const effect = calls.at(-1)?.at(-1);
      if (typeof effect !== 'function') throw new Error('no effect handed to the repository');
      notify.emitUnattended.mockClear();
      await effect({});
      return notify.emitUnattended.mock.calls;
    };
    const told = [
      [{}, [{ kind: 'job.finished', subjectType: 'notes', subjectId: entityId, to: ['reader-1'] }]],
    ];
    expect(await effectOf(asked, 'publish')).toEqual(told);
    expect(await effectOf(asked, 'fail')).toEqual(told);
    expect(await effectOf({ ...job, createdBy: 'admin-1' }, 'fail')).toEqual([]);
  });
  it('ADMIN-B33 stopping twice drains once', async () => {
    handler.run.mockResolvedValue({ completed: true });
    const stop = startRunner();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stop()).toBe(stop());
    await stop();
  });
});
describe('shutdown signals', () => {
  it('ADMIN-B33 SIGTERM and SIGINT drain once and exit with the signal code when Next does not', async () => {
    vi.useRealTimers();
    const stop = vi.fn(async () => {});
    const exit = vi.fn();
    const handle = shutdownHandler(stop, exit);
    handle('SIGINT');
    handle('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    expect(stop).toHaveBeenCalledTimes(1);
    const managed = shutdownHandler(stop, null);
    managed('SIGTERM');
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
