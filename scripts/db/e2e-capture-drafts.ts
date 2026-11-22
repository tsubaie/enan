import { closeDatabase, db, withTransaction } from '../../src/core/db/client';
import { id } from '../../src/core/db/ids';
import * as repo from '../../src/modules/captures/repo';
// The browser suite runs with AI off, so no interpreter can turn a capture into drafts. This
// stands in for `ai.captures.interpret`'s publish on one lane's database: it gives the capture
// named by CAPTURE_ID a transcript and two drafts (a task and a meeting note), each pointing at
// its sentence, and marks it ready. Nothing else is touched; Approve stays the only way to a
// live record.
const captureId = process.env.CAPTURE_ID ?? '';
const task = 'Send the updated supplier quote before Thursday.';
const meeting = 'In the executive meeting we postponed the warehouse expansion.';
const transcript = `${task} ${meeting}`;
const span = (sentence: string) => ({
  start: transcript.indexOf(sentence),
  end: transcript.indexOf(sentence) + sentence.length,
});
await withTransaction(db(), async (database) => {
  const capture = await repo.selectStoredCapture(database, captureId);
  if (!capture) throw new Error(`no capture ${captureId}`);
  await repo.updateCapture(database, captureId, { transcript, status: 'ready', errorCode: null });
  await repo.replacePendingSuggestions(database, captureId, id(), [
    {
      id: id(),
      captureId,
      kind: 'task',
      payload: {
        title: 'Send the updated supplier quote',
        ownerId: null,
        dueDate: null,
        committeeId: null,
        priority: null,
        status: 'inbox',
      },
      sourceSpans: [span(task)],
      createdBy: capture.createdBy,
    },
    {
      id: id(),
      captureId,
      kind: 'meeting_note',
      payload: {
        title: 'Warehouse expansion postponed',
        type: 'other',
        noteDate: new Date().toISOString().slice(0, 10),
        body: meeting,
        committeeId: null,
        participantIds: [],
        tags: [],
      },
      fieldStates: {},
      sourceSpans: [span(meeting)],
      typeFlag: 'task',
      createdBy: capture.createdBy,
    },
  ]);
});
closeDatabase();
