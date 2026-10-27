import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { countQueries } from '@/core/db/query-log';
import { NoteListQuery } from '../schema/validation';
import * as service from '../service';
import * as repo from '../repo';
import * as voiceRepo from '../voice/repo';
import { id } from '@/core/db/ids';
import { harness } from './fixtures';
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
it('NOTES-B02 selects the page with every view count in one statement', async () => {
  await harness.note('One', { tags: ['x'] });
  await harness.note('Two');
  const query = NoteListQuery.parse({ q: 'o' });
  const views = service.viewsFor(['board_meeting', 'other']);
  const dates = { today: '2026-09-10', weekStart: '2026-09-04' };
  const { result, queries } = await countQueries(() =>
    repo.selectNotes(db(), query, dates, views, repo.sortSpec('default'), 10, null),
  );
  expect(queries).toBe(1);
  expect(result).toHaveLength(2);
  expect(result[0]?.counts).toMatchObject({ all: 2, archived: 0, trash: 0, 'type:other': 0 });
  const empty = await repo.selectNotes(
    db(),
    NoteListQuery.parse({ q: 'zzz' }),
    dates,
    views,
    repo.sortSpec('title'),
    10,
    null,
  );
  expect(empty).toEqual([]);
  expect(
    await repo.countNotes(db(), NoteListQuery.parse({ q: 'zzz' }), dates, views),
  ).toMatchObject({ all: 0 });
});
it('NOTES-B33 the list counts each note’s live voice memos inside its one statement', async () => {
  const spoken = await harness.note('Spoken');
  await harness.note('Silent');
  await harness.run(async (ctx) => {
    const fileId = await voiceRepo.upsertAudioFile(ctx.db, {
      storageKey: 'voice-0000',
      originalName: 'Memo.webm',
      mime: 'audio/webm',
      sizeBytes: 4,
      sha256: '0000',
    });
    for (const deletedAt of [null, null, new Date()])
      await voiceRepo.insertVoiceMemo(ctx.db, { id: id(), noteId: spoken.id, fileId, deletedAt });
    return {};
  });
  const views = service.viewsFor([]);
  const dates = { today: '2026-09-10', weekStart: '2026-09-04' };
  const { result, queries } = await countQueries(() =>
    repo.selectNotes(db(), NoteListQuery.parse({}), dates, views, repo.sortSpec('title'), 10, null),
  );
  expect(queries).toBe(1);
  expect(result.map((row) => [row.title, row.voiceMemoCount])).toEqual([
    ['Silent', 0],
    ['Spoken', 2],
  ]);
});
