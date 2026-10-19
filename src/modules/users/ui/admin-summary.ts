import { z } from 'zod';
// ADMIN-B39: what the administration overview reads from the lists the admin pages already load.
// Each reading is undefined until its own list arrives, so one slow list never holds the others.
const Dated = z.array(z.object({ createdAt: z.string() }));
const Jobs = z.array(z.object({ status: z.string() }));
const Connection = z.object({ state: z.string(), checkedAt: z.string().nullable() });
type Member = { role: string; isActive: boolean };
export type AiReading = 'connected' | 'failed' | 'notConfigured' | 'notTested';
export type AdminSummary = {
  members?: { active: number; admins: number };
  ai?: AiReading;
  lastBackupAt?: string | null;
  jobs?: { failed: number; active: number };
  lastChangeAt?: string | null;
};
export type Attention = 'failedJobs' | 'noBackup' | 'aiFailed';
export function readMembers(users: Member[]) {
  const active = users.filter((user) => user.isActive);
  return { active: active.length, admins: active.filter((user) => user.role === 'admin').length };
}
// A workspace that never set AI up is not at fault (ADMIN-B29); only a failed test is.
export function readAi(data: unknown): AiReading {
  const connection = Connection.parse(data);
  if (connection.state === 'enabled') return 'connected';
  if (connection.state === 'error') return 'failed';
  return connection.checkedAt ? 'notConfigured' : 'notTested';
}
// Both lists arrive newest first (backups by manifest date, audit by time).
export function readLatest(data: unknown) {
  return Dated.parse(data)[0]?.createdAt ?? null;
}
// The jobs list covers the last seven days (ADMIN-B15).
export function readJobs(data: unknown) {
  const jobs = Jobs.parse(data);
  return {
    failed: jobs.filter((job) => job.status === 'failed').length,
    active: jobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
  };
}
// Only states an administrator can act on are raised, most damaging first. Thresholds that would
// be a product decision (how old a backup may get) are not invented here: the age is shown instead.
export function attentionOf(summary: AdminSummary): Attention[] {
  const items: Attention[] = [];
  if (summary.jobs && summary.jobs.failed > 0) items.push('failedJobs');
  if (summary.lastBackupAt === null) items.push('noBackup');
  if (summary.ai === 'failed') items.push('aiFailed');
  return items;
}
