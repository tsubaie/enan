// ADMIN-B57, ADMIN-B58, ADMIN-B67, ADMIN-B68: what Admin → Updates reads and sends.
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
  automatic: z.boolean(),
  window: z.string().optional(),
  timeZone: z.string().optional(),
  confirm: z.boolean(),
  updaterUpdate: z.string().optional(),
  intervalSeconds: z.number(),
  // ADR 0060: what the updater understands; ADMIN-B74 needs 2 to replace it from here.
  protocol: z.number().default(0),
  startedAt: z.string().optional(),
});
export type Status = z.infer<typeof Status>;
export const Health = z.enum(['running', 'stalled', 'not_running', 'unreadable']);
const Updates = z.object({
  data: z.object({
    health: Health,
    status: Status.nullable(),
    history: z.array(Status),
    commands: z.boolean(),
    // ADMIN-B69: the updater is older than this release of Enan needs.
    outdated: z.boolean(),
  }),
});
export type Command =
  | { command: 'check' | 'resume' | 'retry' | 'update_updater' }
  | { command: 'install'; digest: string; confirm: boolean }
  // ADMIN-B75: only the updater newer; it installs whatever is waiting.
  | { command: 'install'; confirm: boolean }
  | { command: 'settings'; automatic: boolean; window: string };
export const Sent = z.enum(['check', 'resume', 'retry', 'install', 'settings', 'update_updater']);
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
  'available',
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
const key = ['admin', 'updates'];
export type Answer = z.infer<typeof Updates>;

// ADMIN-B58: the page refreshes only while something is happening: the updater is checking or
// installing, or a command sent in the last minute has not yet changed what the updater says.
// React Query keeps the same object when a refresh returns the same answer, so an unchanged
// answer is the very object the command was sent from.
export function refreshEvery(
  answer: Answer | undefined,
  sent: { status: string; submittedAt: number; before: Answer | undefined } | undefined,
  now: number,
): number | false {
  const state = answer?.data.status?.state;
  if (state === 'checking' || state === 'updating') return 3000;
  if (!sent || now - sent.submittedAt > 60_000) return false;
  if (sent.status === 'pending') return 3000;
  return sent.status === 'success' && sent.before === answer ? 3000 : false;
}
// What useCommand's onMutate kept: z.custom passes the answer through as is, so it compares by identity.
const SentFrom = z.object({ before: z.custom<Answer>().optional() });
export function useUpdates() {
  const client = useQueryClient();
  return useQuery({
    queryKey: key,
    queryFn: () => request('/admin/updates', Updates),
    refetchInterval: (query) => {
      const sent = client.getMutationCache().findAll({ mutationKey: key }).at(-1)?.state;
      const from = SentFrom.safeParse(sent?.context);
      return refreshEvery(
        query.state.data,
        sent && { status: sent.status, submittedAt: sent.submittedAt, before: from.data?.before },
        Date.now(),
      );
    },
  });
}
export function useCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: key,
    onMutate: () => ({ before: client.getQueryData<Answer>(key) }),
    mutationFn: (command: Command) =>
      request('/admin/updates', z.object({ data: z.object({ command: Sent }) }), {
        method: 'POST',
        body: command,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
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
