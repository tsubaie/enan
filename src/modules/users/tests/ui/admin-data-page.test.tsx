// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import { AdminDataPage } from '../../ui/AdminDataPage';
import { mount } from './harness';
type Query = { isPending: boolean; error: Error | null; data: { data: object; meta?: object } | undefined };
const state = vi.hoisted(() => {
  const query = (data: object): Query => ({ isPending: false, error: null, data: { data } });
  return {
    resource: query([]),
    action: { mutate: vi.fn(), isPending: false, isSuccess: false, error: null as Error | null },
    credentials: query({ provider: 'openrouter', source: 'none' }),
    controls: query({
      enabledCapabilities: ['tasks.breakdown', 'notes.refine'],
      monthlyBudgetMicros: 20_000_000,
      usedTokens: 60000,
      reservedTokens: 25000,
      usage: [
        {
          capability: 'notes.refine',
          calls: 12,
          inputTokens: 40000,
          outputTokens: 15000,
          cacheTokens: 5000,
          estimatedCostMicros: 1250000,
        },
      ],
    }),
    saveControls: {
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      error: null as Error | null,
    },
    remove: { mutate: vi.fn(), isPending: false, error: null as Error | null, reset: vi.fn() },
    reset() {
      state.resource = query([]);
      state.remove = { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() };
      state.action = { mutate: vi.fn(), isPending: false, isSuccess: false, error: null };
      state.saveControls = { mutate: vi.fn(), isPending: false, isSuccess: false, error: null };
    },
  };
});
vi.mock('../../ui/queries', () => ({
  useAdminResource: () => state.resource,
  useAdminAction: () => state.action,
  useDeleteBackup: () => state.remove,
}));
vi.mock('../../ui/ai-queries', () => ({
  useAiCredentials: () => state.credentials,
  useSaveAiCredentials: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useRemoveAiCredentials: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useAiModels: () => ({
    isPending: true,
    isFetching: false,
    error: null,
    data: undefined,
    refetch: vi.fn(),
  }),
  useSaveAiModels: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null }),
  useAiControls: () => state.controls,
  useSaveAiControls: () => state.saveControls,
}));
beforeEach(() => state.reset());
it('ADMIN-B12 the backups page offers Create now and lists each backup with its status', () => {
  mount(<AdminDataPage resource="backups" />);
  expect(screen.getByText(en.admin.noBackups)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.admin.createBackup }));
  expect(state.action.mutate).toHaveBeenCalledTimes(1);
  // The backup this page started is reported once it is listed (ADMIN-B46).
  state.resource.data = {
    data: [{ id: 'backup-2026-09-10', createdAt: '2026-09-10T08:00:00.000Z', status: 'verified' }],
    meta: { runner: true, job: null },
  };
  Object.assign(state.action, { isSuccess: true, data: { data: { id: 'backup-2026-09-10' } } });
  mount(<AdminDataPage resource="backups" />);
  expect(screen.getByText(/^Backup of Sep 10, 2026/u)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(en.admin.backupFinished);
  expect(screen.queryByText(en.admin.noBackups)).toBeNull();
});
it('ADMIN-B12 a backup is deleted only after the confirmation, and Keep deletes nothing', () => {
  state.resource.data = {
    data: [{ id: 'backup-2026-09-10', createdAt: '2026-09-10T08:00:00.000Z' }],
    meta: { runner: true, job: null },
  };
  mount(<AdminDataPage resource="backups" />);
  const remove = () => screen.getByRole('button', { name: /^Delete the backup of Sep 10, 2026/u });
  fireEvent.click(remove());
  fireEvent.click(screen.getByRole('button', { name: en.admin.backupKeep }));
  expect(state.remove.mutate).not.toHaveBeenCalled();
  fireEvent.click(remove());
  expect(screen.getByText(en.admin.backupDeleteConfirm)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.admin.backupDeleteAction }));
  expect(state.remove.mutate).toHaveBeenCalledWith('backup-2026-09-10', expect.anything());
});
it('ADMIN-B12 ADMIN-B46 a backup made here and then deleted is not reported as started again', () => {
  state.resource.data = {
    data: [],
    meta: {
      runner: true,
      job: {
        id: 'backup-1',
        kind: 'system.backup',
        status: 'succeeded',
        createdAt: '2026-09-10T08:00:00.000Z',
        lastError: null,
      },
    },
  };
  Object.assign(state.action, { isSuccess: true, data: { data: { id: 'backup-1' } } });
  mount(<AdminDataPage resource="backups" />);
  expect(screen.queryByText(en.admin.backupStarted)).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});
it('ADMIN-B15 ADMIN-B16 jobs show kind, status and last error; audit rows show what was done', () => {
  state.resource.data = {
    data: [
      {
        id: 'job-1',
        createdAt: '2026-09-10T08:00:00.000Z',
        kind: 'system.backup',
        status: 'failed',
        lastError: 'disk full',
      },
    ],
  };
  mount(<AdminDataPage resource="jobs" />);
  expect(screen.getByText(en.admin.jobKind_system_backup)).toBeTruthy();
  expect(screen.getByText(en.admin.jobState_failed)).toBeTruthy();
  expect(screen.getByText('disk full')).toBeTruthy();
  expect(screen.queryByRole('button', { name: en.admin.createBackup })).toBeNull();
  state.resource.data = {
    data: [
      {
        id: 'audit-1',
        createdAt: '2026-09-10T08:00:00.000Z',
        action: 'create',
        entityType: 'user',
        diff: { name: 'Invited', role: 'member' },
      },
    ],
  };
  mount(<AdminDataPage resource="audit" />);
  // Audit rows read as words (ADMIN-B43); their wording is covered in audit-history.test.tsx.
  expect(screen.getByText(new RegExp(en.admin.auditAction_create, 'u'))).toBeTruthy();
  state.resource.data = { data: [] };
  mount(<AdminDataPage resource="audit" />, 'ar');
  expect(screen.getByText(ar.admin.noAudit)).toBeTruthy();
});
it('ADMIN-B15 a failed resource read offers a retry rather than an empty page', () => {
  state.resource.error = new ApiError('internal', en.errors.internal, {}, 'req-3');
  mount(<AdminDataPage resource="jobs" />);
  expect(screen.getByRole('alert').textContent).toContain(en.errors.internal);
  expect(screen.getByRole('button', { name: en.common.retry })).toBeTruthy();
});
