import 'server-only';
import { inArray } from 'drizzle-orm';
import { jobs } from './system-schema';
import { db } from './client';
// ADR 0067: the kinds with anything to claim, sweep or recover, read outside the lock so an idle
// runner tick opens no transaction. A running job whose lease expired is among them.
// shortcut: apart from jobs-repo.ts, which is at the 400-line limit; fold it back when that file is split.
export async function activeKinds() {
  const rows = await db()
    .selectDistinct({ kind: jobs.kind })
    .from(jobs)
    .where(inArray(jobs.status, ['queued', 'running']));
  return rows.map((row) => row.kind);
}
