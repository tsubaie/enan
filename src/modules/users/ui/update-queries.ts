// ADMIN-B57, ADMIN-B58: what Admin → Updates reads and sends.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';

// ADMIN-B57: the shape GET /admin/updates answers with (src/core/updates/updater.ts).
const Image = z.object({
  digest: z.string().optional(),
  version: z.string().optional(),
  revision: z.string().optional(),
});
export const Status = z.object({
  channel: z.string(),
  running: Image.optional(),
  candidate: Image.optional(),
  state: z.string(),
  step: z.string().optional(),
  error: z.string().optional(),
  backup: z.string().optional(),
  restoreCommand: z.string().optional(),
  log: z.string().optional(),
  finishedAt: z.string().optional(),
  lastCheckAt: z.string().optional(),
  paused: z.boolean(),
  updaterUpdate: z.string().optional(),
  intervalSeconds: z.number(),
});
export type Status = z.infer<typeof Status>;
export const Health = z.enum(['running', 'stalled', 'not_running', 'unreadable']);
const Updates = z.object({
  data: z.object({
    health: Health,
    status: Status.nullable(),
    history: z.array(Status),
    commands: z.boolean(),
  }),
});
export const Command = z.enum(['check', 'pause', 'resume', 'retry']);
export type Command = z.infer<typeof Command>;
export const State = z.enum([
  'checking',
  'checked',
  'updating',
  'updated',
  'failed',
  'rolled_back',
  'rollback_failed',
  'blocked',
  'paused',
]);
export type State = z.infer<typeof State>;
export const Step = z.enum(['check', 'pull', 'guard', 'backup', 'switch', 'verify', 'rollback']);
// The outcomes that leave something for an administrator to read or do, and their headings.
export const Attention = z.enum(['failed', 'rolled_back', 'rollback_failed', 'blocked']);
export const outcomeTitle: Record<
  z.infer<typeof Attention>,
  | 'updateOutcomeFailed'
  | 'updateOutcomeRolledBack'
  | 'updateOutcomeRollbackFailed'
  | 'updateOutcomeBlocked'
> = {
  failed: 'updateOutcomeFailed',
  rolled_back: 'updateOutcomeRolledBack',
  rollback_failed: 'updateOutcomeRollbackFailed',
  blocked: 'updateOutcomeBlocked',
};
export function useUpdates() {
  return useQuery({
    queryKey: ['admin', 'updates'],
    queryFn: () => request('/admin/updates', Updates),
    // The updater acts on a command within half a minute; the page follows it closely.
    refetchInterval: 5000,
  });
}
export function useCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: Command) =>
      request('/admin/updates', z.object({ data: z.object({ command: Command }) }), {
        method: 'POST',
        body: { command },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'updates'] }),
  });
}

// The outcome the page explains: the newest failure, rollback or hold since the last successful
// update. The updater overwrites its status on every check, so after a rollback the next check (an
// image held because it failed before) would otherwise hide the backup and restore command.
export function latestIssue(status: Status | null, history: Status[]): Status | null {
  const issue = (entry: Status, current: boolean) =>
    Attention.safeParse(entry.state).success &&
    // A held image that failed before repeats the failure already shown.
    !(entry.state === 'blocked' && entry.step === 'check') &&
    // A check that could not reach the registry matters only while it is the latest word.
    (current || !(entry.state === 'failed' && entry.step === 'check'));
  if (status && issue(status, true)) return status;
  for (const entry of history) {
    if (entry.state === 'updated') return null;
    if (issue(entry, false)) return entry;
  }
  return null;
}
