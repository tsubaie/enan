import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { scratchDirectory } from './fixtures/scratch';
import { databaseFor, openClient, type DatabaseClient } from '../client';
import { importPostgres, SourceRow, withSystemTables } from '../postgres-import';
import { moduleTargets } from '../../../../scripts/db/postgres-import-targets';
import { users } from '../system-schema';
import { notes } from '@/modules/notes/schema/db';
import { kpiReadings, kpis } from '@/modules/kpis/schema/db';
import { tasks } from '@/modules/tasks/schema/db';
import { searchCorpus } from '@/core/search/normalize';

// Rows as scripts/db/export-postgres.sh writes them: `row_to_json` of the PostgreSQL schema
// before ADR 0029 (timestamptz with microseconds, text[] and jsonb as JSON, date as text).
const user = {
  id: '01a00000-0000-7000-8000-000000000001',
  email: 'owner@example.test',
  name: 'Owner',
  password_hash: 'x',
  role: 'admin',
  is_active: true,
  created_at: '2026-09-29T09:15:13.817764+00:00',
};
const parent = {
  id: '01a00000-0000-7000-8000-0000000000a1',
  title: 'آلية التعامل مع الملفات',
  description: 'Parent',
  sort_order: 0,
  status: 'inbox',
  created_at: '2026-10-01T08:00:00.5+00:00',
  due_date: '2026-10-20',
};
const child = {
  id: '01a00000-0000-7000-8000-0000000000a2',
  title: 'Child',
  parent_id: parent.id,
  sort_order: 0,
  status: 'completed',
  completed_at: '2026-10-02T08:00:00+00:00',
};
const note = {
  id: '01a00000-0000-7000-8000-0000000000b1',
  title: 'اجتماع فريق العمل',
  note_date: '2026-09-29',
  content: 'المحتوى',
  tags: ['رأس المال البشري', 'نقل'],
  search_text: 'stale generated value',
};
const kpi = { id: '01a00000-0000-7000-8000-0000000000c1', name: 'Coverage', unit: 'percent' };
const reading = {
  id: '01a00000-0000-7000-8000-0000000000c2',
  kpi_id: kpi.id,
  reading_date: '2026-09-30',
  value: 97.1234,
};
function export_(rows: Record<string, object[]> = {}) {
  const source = new Map(
    [...withSystemTables(moduleTargets().tables).keys()].map((name) => [
      name,
      [] as ReturnType<typeof SourceRow.parse>[],
    ]),
  );
  for (const [name, list] of Object.entries(rows))
    source.set(
      name,
      list.map((row) => SourceRow.parse(row)),
    );
  return source;
}
const run = (
  into: DatabaseClient,
  source: ReturnType<typeof export_>,
  allowDrop?: ReadonlySet<string>,
) => importPostgres(into, source, moduleTargets(), allowDrop);
let scratch: ReturnType<typeof scratchDirectory> | undefined;
let client: DatabaseClient | undefined;
function target() {
  scratch = scratchDirectory('eos-import-');
  client = openClient(`file:${scratch.path('import_test.db')}`, 1);
  return client;
}
afterEach(() => {
  client?.close();
  client = undefined;
  scratch?.remove();
});

describe('PostgreSQL import (ADR 0029)', () => {
  it('carries every value across: timestamps to the millisecond, JSON arrays, dates, decimals, booleans, Arabic text', async () => {
    const into = target();
    const { counts } = await run(
      into,
      export_({
        users: [user],
        tasks: [child, parent],
        notes: [note],
        kpis: [kpi],
        kpi_readings: [reading],
      }),
    );
    expect(counts.get('tasks')).toBe(2);
    const database = databaseFor(into);
    const [owner] = await database.select().from(users);
    expect(owner?.createdAt.getTime()).toBe(Date.UTC(2026, 8, 29, 9, 15, 13, 817));
    expect(owner?.isActive).toBe(true);
    const [stored] = await database.select().from(notes);
    expect(stored?.tags).toEqual(note.tags);
    expect(stored?.noteDate).toBe('2026-09-29');
    const [value] = await database.select().from(kpiReadings);
    expect(value?.value).toBe(97.1234);
    const [sub] = await database.select().from(tasks).where(eq(tasks.id, child.id));
    expect(sub?.parentId).toBe(parent.id);
  });
  it("recomputes search_text with the repos' corpus instead of copying PostgreSQL's", async () => {
    const into = target();
    await run(into, export_({ notes: [note], tasks: [parent], kpis: [kpi] }));
    const [stored] = await databaseFor(into).select().from(notes);
    expect(stored?.searchText).toBe(searchCorpus(note.title, note.content, ...note.tags));
    const [task] = await databaseFor(into).select().from(tasks);
    expect(task?.searchText).toBe(searchCorpus(parent.title, parent.description));
  });
  it('refuses a source column with no target instead of dropping it, unless allowed', async () => {
    await expect(run(target(), export_({ kpis: [{ ...kpi, teams: 'Ops' }] }))).rejects.toThrow(
      'kpis.teams',
    );
    client?.close();
    scratch?.remove();
    const { dropped } = await run(
      target(),
      export_({ kpis: [{ ...kpi, teams: 'Ops' }] }),
      new Set(['kpis.teams']),
    );
    expect(dropped).toEqual(['kpis.teams']);
  });
  it('refuses an export whose tables differ from the schema', async () => {
    const source = export_();
    source.delete('tasks');
    source.set('legacy', []);
    await expect(run(target(), source)).rejects.toThrow(
      'no export for [tasks]; no target for [legacy]',
    );
  });
  it('fails on a value that does not fit its column or a row a constraint refuses, and commits nothing', async () => {
    await expect(
      run(target(), export_({ users: [{ ...user, created_at: 'infinity' }] })),
    ).rejects.toThrow('users.created_at');
    client?.close();
    scratch?.remove();
    const into = target();
    await expect(
      run(
        into,
        export_({
          kpis: [kpi, { ...kpi, id: '01a00000-0000-7000-8000-0000000000c9', unit: 'liters' }],
        }),
      ),
    ).rejects.toThrow();
    expect(await databaseFor(into).select().from(kpis)).toEqual([]);
  });
  it('refuses a child whose parent is missing (foreign keys checked at commit)', async () => {
    await expect(run(target(), export_({ tasks: [child] }))).rejects.toThrow();
  });
});
