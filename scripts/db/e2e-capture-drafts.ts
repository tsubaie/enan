import { closeDatabase, db, withTransaction } from '../../src/core/db/client';
import { id } from '../../src/core/db/ids';
import { claim, enqueue, publish } from '../../src/core/db/jobs-repo';
import * as repo from '../../src/modules/captures/repo';
import { notifyReady } from '../../src/modules/captures/notifications';
// The browser suite runs with AI off, so no interpreter can turn a capture into drafts. This
// stands in for `ai.captures.interpret`'s publish on one lane's database: it gives the capture
// named by CAPTURE_ID a transcript and two drafts (a task and a meeting note), each pointing at
// its sentence, and marks it ready, telling the recorder in their grouped bell line exactly as the
// publish does (CAPTURES-B21). Nothing else is touched; Approve stays the only way to a live record.
// CAPTURE_STEP=processing instead leaves the capture transcribing on a job of a kind no runner
// takes, so it stays in progress for as long as a scenario needs; CAPTURE_STEP=finished then claims
// and publishes that job with nothing in it, as a transcription whose result the fence dropped
// (the capture deleted meanwhile) ends: succeeded, the capture untouched.
const captureId = process.env.CAPTURE_ID ?? '';
const step = process.env.CAPTURE_STEP ?? 'drafts';
const standIn = 'e2e.captures.stand-in';
const task = 'Send the updated supplier quote before Thursday.';
const meeting = 'In the executive meeting we postponed the warehouse expansion.';
const transcript = `${task} ${meeting}`;
const span = (sentence: string) => ({
  start: transcript.indexOf(sentence),
  end: transcript.indexOf(sentence) + sentence.length,
});
if (step === 'processing')
  await withTransaction(db(), async (database) => {
    const job = await enqueue(database, standIn, { captureId }, `${standIn}:${captureId}`);
    await repo.updateCapture(database, captureId, {
      status: 'transcribing',
      transcribeJobId: job.id,
    });
  });
else if (step === 'finished') {
  const job = await claim('e2e', standIn, 1, 100);
  if (!job || JSON.stringify(job.payload) !== JSON.stringify({ captureId }))
    throw new Error(`no ${standIn} job to finish for ${captureId}`);
  await publish(job, {});
} else
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
    await notifyReady(database, capture);
  });
closeDatabase();
