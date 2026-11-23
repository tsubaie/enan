// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { CaptureGroup } from '../../schema/validation';
import { CapturesPage } from '../../ui/CapturesPage';
import { useReviewToast } from '../../ui/review-toast';
import { mount } from '../../../../../tests/fixtures/mount';
// CAPTURES-B08 CAPTURES-B09 CAPTURES-B10: the inbox as the page renders it, with the review
// actions as spies; nothing reaches a server.
const spies = vi.hoisted(() => ({
  patch: vi.fn(),
  approve: vi.fn(),
  approveReady: vi.fn(),
  discard: vi.fn(),
  undo: vi.fn(),
  merge: vi.fn(),
  toast: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  removeCapture: vi.fn(),
  restoreCapture: vi.fn(),
  list: { data: [] as object[], meta: { nextCursor: null } },
  // The inbox re-reads after a review action, as the real query does once it is invalidated.
  listeners: new Set<() => void>(),
}));
vi.mock('../../ui/capture-queries', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    spies.listeners.add(listener);
    return () => spies.listeners.delete(listener);
  };
  return {
    useCaptures: () => ({
      data: useSyncExternalStore(subscribe, () => spies.list),
      isPending: false,
      error: null,
      refetch: async () => ({ data: spies.list }),
    }),
    useReviewMutations: () => ({
      patch: spies.patch,
      approve: spies.approve,
      approveReady: spies.approveReady,
      discard: spies.discard,
      undo: spies.undo,
      merge: spies.merge,
      typeTranscript: vi.fn(),
      removeCapture: spies.removeCapture,
      restoreCapture: spies.restoreCapture,
    }),
    useAssignablePeople: () => [
      { id: '01a08a9f-1991-760a-b73a-568f6f8665a1', fullName: 'Finance Lead', displayName: null },
    ],
    useRetryCapture: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  };
});
vi.mock('@/modules/committees/ui', () => ({
  useCommitteeChoices: () => ({ data: { data: [] } }),
  CommitteePicker: () => <div data-testid="committee-picker" />,
}));
vi.mock('@/modules/notes/ui', async () => ({
  clock: (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
  TypeSelect: () => <div data-testid="type-select" />,
  useNoteTypes: () => ({ data: undefined }),
  useTypeLabel: () => (id: string) => id,
}));
vi.mock('@/ui/primitives/toast', () => ({
  useToastManager: () => ({ add: spies.toast, update: spies.update, close: spies.close }),
}));
const captureId = '01a08a9f-1991-760a-b73a-568f6f866600';
const transcript =
  'Send the updated supplier quote before Thursday. And a note for the projects committee: review the timeline.';
const sentence = 'And a note for the projects committee: review the timeline.';
const draft = <Fields extends object>(fields: Fields) => ({
  revision: 1,
  captureId,
  fieldStates: {},
  sourceSpans: [],
  typeFlag: null,
  status: 'pending',
  liveEntityType: null,
  liveEntityId: null,
  createdAt: '2026-09-10T08:40:00.000Z',
  updatedAt: '2026-09-10T08:40:00.000Z',
  ...fields,
});
const taskId = '01a08a9f-1991-760a-b73a-568f6f866601';
const task = draft({
  id: taskId,
  kind: 'task',
  payload: { title: 'Submit the Q3 report', ownerId: null, spokenOwner: 'the planning head' },
  fieldStates: { ownerId: { state: 'unknown', candidates: [], sourceText: 'the planning head' } },
  typeFlag: 'meeting_note',
});
const committeeNote = draft({
  id: '01a08a9f-1991-760a-b73a-568f6f866602',
  kind: 'committee_note',
  payload: {
    title: 'Review the timeline',
    committeeId: null,
    noteDate: '2026-09-10',
    body: 'Review',
  },
  fieldStates: { committeeId: { state: 'unknown', candidates: [] } },
  sourceSpans: [
    { start: transcript.indexOf(sentence), end: transcript.indexOf(sentence) + sentence.length },
  ],
});
const group = CaptureGroup.parse({
  id: captureId,
  revision: 1,
  fileId: '01a08a9f-1991-760a-b73a-568f6f866603',
  durationSeconds: 72,
  transcript,
  status: 'ready',
  errorCode: null,
  errorDetail: null,
  contextCommitteeId: null,
  contextNoteType: null,
  transcribeJobId: null,
  interpretJobId: null,
  createdAt: '2026-09-10T06:40:00.000Z',
  updatedAt: '2026-09-10T06:40:00.000Z',
  createdBy: null,
  updatedBy: null,
  audioUrl: `/api/v1/captures/${captureId}/audio`,
  suggestions: [task, committeeNote],
});
const play = vi.fn();
beforeEach(() => {
  for (const spy of [
    spies.patch,
    spies.approve,
    spies.approveReady,
    spies.discard,
    spies.merge,
    spies.toast,
    spies.update,
    spies.close,
    spies.removeCapture,
    spies.restoreCapture,
  ])
    spy.mockReset().mockResolvedValue({ data: {} });
  spies.list = { data: [group], meta: { nextCursor: null } };
  localStorage.clear();
  play.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());
const page = (locale: 'en' | 'ar' = 'en') =>
  mount(<CapturesPage initial={spies.list as never} scope="mine" admin={false} />, locale);
it('CAPTURES-B02 the education line is shown until dismissed, then stays dismissed on this device', () => {
  page();
  const note = screen.getByRole('note');
  expect(note.textContent).toContain(en.captures.education);
  fireEvent.click(within(note).getByRole('button', { name: en.captures.dismiss }));
  expect(screen.queryByRole('note')).toBeNull();
  page();
  expect(screen.queryByText(en.captures.education)).toBeNull();
});
it('CAPTURES-B08 Listen plays the whole clip from the start and highlights the source sentence', () => {
  page();
  const card = screen.getAllByTestId('suggestion-card')[1];
  if (!card) throw new Error('no committee note card');
  const audio = screen.getByTestId('capture-audio');
  if (!(audio instanceof HTMLAudioElement)) throw new Error('no audio');
  audio.currentTime = 30;
  fireEvent.click(within(card).getByRole('button', { name: en.captures.listen }));
  expect(play).toHaveBeenCalledTimes(1);
  expect(audio.currentTime).toBe(0);
  expect(audio.getAttribute('src')).toBe(group.audioUrl);
  expect(within(card).getByText(sentence).tagName).toBe('MARK');
  const full = screen.getByTestId('capture-transcript');
  expect(full.querySelector('mark')?.textContent).toBe(sentence);
  expect(within(card).getByText(en.captures.listenHint)).toBeTruthy();
});
it('CAPTURES-B09 an unmatched owner is said in words with Choose and Clear, and does not block Approve', () => {
  page();
  const card = screen.getAllByTestId('suggestion-card')[0];
  if (!card) throw new Error('no task card');
  expect(within(card).getByText(en.captures.unknown_ownerId)).toBeTruthy();
  expect(within(card).getByText(en.captures.ownerOptional)).toBeTruthy();
  expect(within(card).getByText(en.captures.nonBlocking)).toBeTruthy();
  expect(within(card).getByText(en.captures.typeFlag_task)).toBeTruthy();
  expect(card.textContent).not.toMatch(/%/u);
  const approve = within(card).getByRole('button', { name: en.captures.approve });
  expect(approve.getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: en.captures.clearOwner }));
  expect(spies.patch).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, revision: 1 }), {
    payload: { ownerId: null },
  });
  fireEvent.click(within(card).getByRole('button', { name: en.captures.chooseOwner }));
  expect(within(card).getByRole('option', { name: 'Finance Lead' })).toBeTruthy();
});
it('CAPTURES-B10 Approve with the committee unsettled is aria-disabled and says why in text; nothing is sent', () => {
  page();
  const card = screen.getAllByTestId('suggestion-card')[1];
  if (!card) throw new Error('no committee note card');
  const approve = within(card).getByRole('button', { name: en.captures.approve });
  expect(approve.getAttribute('aria-disabled')).toBe('true');
  const reason = document.getElementById(approve.getAttribute('aria-describedby') ?? '');
  expect(reason?.textContent).toBe(en.captures.blocked_committeeId);
  expect(within(card).getByText(en.captures.unknown_committeeId)).toBeTruthy();
  fireEvent.click(approve);
  expect(spies.approve).not.toHaveBeenCalled();
  // Approve N ready counts the type-flagged task, not the unsettled note.
  expect(
    screen.getByRole('button', {
      name: en.captures.approveReady.replace('{count, number, integer}', '1'),
    }),
  ).toBeTruthy();
});
it('CAPTURES-B10 Discard acts at once, with no confirm dialog, and offers Undo for five seconds', async () => {
  page();
  const card = screen.getAllByTestId('suggestion-card')[0];
  if (!card) throw new Error('no task card');
  fireEvent.click(within(card).getByRole('button', { name: en.captures.discard }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(spies.discard).toHaveBeenCalledWith(expect.objectContaining({ id: taskId }));
  await vi.waitFor(() => expect(spies.toast).toHaveBeenCalled());
  expect(spies.toast.mock.calls[0]?.[0]).toMatchObject({
    title: en.captures.discarded,
    timeout: 5000,
    actionProps: { children: en.common.undo },
  });
});
it('CAPTURES-B10 the group header reads time and drafts split by a 1px rule, with age and an unmirrored clock', () => {
  page();
  const heading = screen.getByRole('heading', { level: 3, name: /12:40|6:40/u });
  expect(heading.textContent).toContain('2 drafts');
  expect(heading.querySelector('[aria-hidden].w-px')).toBeTruthy();
  expect(heading.textContent).not.toContain('·');
  const clock = screen.getByText('01:12');
  expect(clock.getAttribute('dir')).toBe('ltr');
  expect(screen.getByRole('button', { name: en.captures.playRecording })).toBeTruthy();
});
it('CAPTURES-B09 in Arabic the inbox uses the approved copy and keeps the clock left to right', () => {
  page('ar');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(ar.captures.review);
  expect(screen.getByText(ar.captures.education)).toBeTruthy();
  expect(screen.getAllByText(ar.captures.discard).length).toBe(2);
  expect(screen.getByText(ar.captures.blocked_committeeId)).toBeTruthy();
  expect(screen.getByText('01:12').getAttribute('dir')).toBe('ltr');
});
const secondTaskId = '01a08a9f-1991-760a-b73a-568f6f866604';
const secondTask = draft({
  id: secondTaskId,
  kind: 'task',
  payload: { title: 'Book the venue', ownerId: null },
});
let shown: { id: string }[] = [];
const withDrafts = (...suggestions: { id: string }[]) => {
  shown = suggestions;
  spies.list = { data: [{ ...group, suggestions }], meta: { nextCursor: null } };
  for (const listener of spies.listeners) listener();
};
const cardOf = (id: string) => document.querySelector(`[data-draft="${id}"]`);
function deferred() {
  let resolve: (value: object) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<object>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
it('CAPTURES-B10 Approve and Discard move focus to the next draft, else the previous, else the heading', async () => {
  withDrafts(task, secondTask, committeeNote);
  page();
  const approval = { suggestion: secondTask, live: { type: 'task', id: secondTaskId } };
  spies.approve.mockImplementation(async () => {
    withDrafts(task, committeeNote);
    return { data: approval };
  });
  spies.discard.mockImplementation(async (gone: { id: string }) => {
    withDrafts(...shown.filter((item) => item.id !== gone.id));
    return { data: {} };
  });
  const second = cardOf(secondTaskId);
  if (!second) throw new Error('no second card');
  await act(async () => {
    fireEvent.click(
      within(second as HTMLElement).getByRole('button', { name: en.captures.approve }),
    );
  });
  expect(document.activeElement).toBe(cardOf(committeeNote.id));
  const last = cardOf(committeeNote.id) as HTMLElement;
  await act(async () => {
    fireEvent.click(within(last).getByRole('button', { name: en.captures.discard }));
  });
  expect(document.activeElement).toBe(cardOf(taskId));
  await act(async () => {
    fireEvent.click(
      within(cardOf(taskId) as HTMLElement).getByRole('button', { name: en.captures.discard }),
    );
  });
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
});
it('CAPTURES-B10 a draft being approved is busy, a second click sends nothing, and a failure is shown', async () => {
  page();
  const pending = deferred();
  spies.approve.mockReturnValue(pending.promise);
  const card = cardOf(taskId) as HTMLElement;
  const approve = within(card).getByRole('button', { name: en.captures.approve });
  fireEvent.click(approve);
  fireEvent.click(approve);
  fireEvent.click(within(card).getByRole('button', { name: en.captures.discard }));
  expect(spies.approve).toHaveBeenCalledTimes(1);
  expect(spies.discard).not.toHaveBeenCalled();
  expect(approve.getAttribute('aria-busy')).toBe('true');
  expect(approve.querySelector('.motion-safe\\:animate-spin')).toBeTruthy();
  await act(async () => pending.reject(new Error('The server is not answering.')));
  expect(within(card).getByRole('alert').textContent).toContain('The server is not answering.');
  expect(approve.getAttribute('aria-busy')).toBeNull();
});
it('CAPTURES-B10 Approve N ready is busy while it is sent, fires once, and says why it failed', async () => {
  page();
  const pending = deferred();
  spies.approveReady.mockReturnValue(pending.promise);
  const ready = screen.getByRole('button', {
    name: en.captures.approveReady.replace('{count, number, integer}', '1'),
  });
  fireEvent.click(ready);
  fireEvent.click(ready);
  // It first waits for any edit still being saved and reads the list again.
  await vi.waitFor(() => expect(spies.approveReady).toHaveBeenCalledTimes(1));
  expect(ready.getAttribute('aria-busy')).toBe('true');
  expect(ready.getAttribute('aria-disabled')).toBe('true');
  await act(async () => pending.reject(new Error('The server is not answering.')));
  expect(screen.getByRole('alert').textContent).toContain('The server is not answering.');
  expect(ready.getAttribute('aria-busy')).toBeNull();
});
it('CAPTURES-B10 after a merge the kept draft has focus', async () => {
  withDrafts(task, secondTask, committeeNote);
  page();
  spies.merge.mockImplementation(async () => {
    withDrafts(secondTask, committeeNote);
    return { data: secondTask };
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.merge }));
  });
  const sheet = screen.getByRole('dialog');
  fireEvent.click(within(sheet).getByRole('radio', { name: /Book the venue/u }));
  await act(async () => {
    fireEvent.click(within(sheet).getByRole('button', { name: en.captures.merge }));
  });
  expect(spies.merge).toHaveBeenCalledWith(captureId, secondTaskId, [taskId]);
  await vi.waitFor(() => expect(document.activeElement).toBe(cardOf(secondTaskId)));
});
it('CAPTURES-B10 across kinds Merge says why beside it, not only in a tooltip', () => {
  page();
  const merge = screen.getByRole('button', { name: en.captures.merge });
  expect(merge.getAttribute('aria-disabled')).toBe('true');
  expect(merge.getAttribute('title')).toBeNull();
  const hint = document.getElementById(merge.getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toBe(en.captures.mergeKindOnly);
});
const editedTitle = 'Submit the Q4 report';
const edited = draft({
  id: taskId,
  kind: 'task',
  revision: 2,
  payload: { title: editedTitle, ownerId: null, spokenOwner: 'the planning head' },
});
const titleOf = (card: HTMLElement) => within(card).getByRole('textbox', { name: /Title/u });
// The reader edits the title and goes straight to an action: the field's blur starts the save.
function editTitle(card: HTMLElement) {
  const title = titleOf(card);
  fireEvent.change(title, { target: { value: editedTitle } });
  fireEvent.blur(title);
}
const sentAfterPatch = (spy: typeof spies.approve) =>
  expect(spies.patch.mock.invocationCallOrder[0]).toBeLessThan(
    spy.mock.invocationCallOrder[0] ?? 0,
  );
it('CAPTURES-B10 Approve right after an edit waits for the save, says so, then approves the edited draft once', async () => {
  page();
  const saving = deferred();
  spies.patch.mockReturnValue(saving.promise);
  spies.approve.mockResolvedValue({
    data: { suggestion: edited, live: { type: 'task', id: taskId } },
  });
  const card = cardOf(taskId) as HTMLElement;
  editTitle(card);
  const approve = within(card).getByRole('button', { name: en.captures.approve });
  fireEvent.click(approve);
  fireEvent.click(approve);
  expect(spies.patch).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), {
    payload: { title: editedTitle },
  });
  expect(spies.approve).not.toHaveBeenCalled();
  expect(approve.getAttribute('aria-busy')).toBe('true');
  expect(approve.querySelector('.motion-safe\\:animate-spin')).toBeTruthy();
  expect(within(card).getByRole('status').textContent).toBe(en.captures.savingChange);
  await act(async () => saving.resolve({ data: edited }));
  expect(spies.approve).toHaveBeenCalledTimes(1);
  expect(spies.approve).toHaveBeenCalledWith(
    expect.objectContaining({ id: taskId, revision: 2, payload: edited.payload }),
  );
  sentAfterPatch(spies.approve);
  expect(screen.queryByText(en.captures.savingChange)).toBeNull();
});
it('CAPTURES-B10 Discard right after an edit waits for the save, then discards with the saved revision', async () => {
  page();
  const saving = deferred();
  spies.patch.mockReturnValue(saving.promise);
  const card = cardOf(taskId) as HTMLElement;
  editTitle(card);
  const discard = within(card).getByRole('button', { name: en.captures.discard });
  fireEvent.click(discard);
  expect(spies.discard).not.toHaveBeenCalled();
  expect(discard.getAttribute('aria-busy')).toBe('true');
  expect(within(card).getByRole('status').textContent).toBe(en.captures.savingChange);
  await act(async () => saving.resolve({ data: edited }));
  expect(spies.discard).toHaveBeenCalledTimes(1);
  expect(spies.discard).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, revision: 2 }));
  sentAfterPatch(spies.discard);
});
it('CAPTURES-B10 when the save before Approve or Discard fails, nothing is sent and the failure is shown', async () => {
  page();
  spies.patch.mockRejectedValue(new Error('The server is not answering.'));
  const card = cardOf(taskId) as HTMLElement;
  editTitle(card);
  await act(async () => {
    fireEvent.click(within(card).getByRole('button', { name: en.captures.approve }));
  });
  editTitle(card);
  await act(async () => {
    fireEvent.click(within(card).getByRole('button', { name: en.captures.discard }));
  });
  expect(spies.patch).toHaveBeenCalledTimes(2);
  expect(spies.approve).not.toHaveBeenCalled();
  expect(spies.discard).not.toHaveBeenCalled();
  expect(within(card).getByRole('alert').textContent).toContain('The server is not answering.');
});
it('CAPTURES-B10 an edit made while the previous one is saving is sent next with the saved revision, and Approve sends both', async () => {
  page();
  const first = deferred();
  const finalTitle = 'Submit the final Q4 report';
  const description = 'Bring the figures';
  const both = draft({
    id: taskId,
    kind: 'task',
    revision: 3,
    payload: { title: finalTitle, description, ownerId: null, spokenOwner: 'the planning head' },
  });
  spies.patch.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: both });
  spies.approve.mockResolvedValue({
    data: { suggestion: both, live: { type: 'task', id: taskId } },
  });
  const card = cardOf(taskId) as HTMLElement;
  editTitle(card);
  // Before the first PATCH answers: the description, then the title once more.
  const field = within(card).getByRole('textbox', { name: /Description/u });
  fireEvent.change(field, { target: { value: description } });
  fireEvent.blur(field);
  const title = titleOf(card);
  fireEvent.change(title, { target: { value: finalTitle } });
  fireEvent.blur(title);
  fireEvent.click(within(card).getByRole('button', { name: en.captures.approve }));
  expect(spies.patch).toHaveBeenCalledTimes(1);
  expect(within(card).getByRole('status').textContent).toBe(en.captures.savingChange);
  await act(async () => first.resolve({ data: edited }));
  expect(spies.patch).toHaveBeenCalledTimes(2);
  expect(spies.patch.mock.calls[1]).toEqual([
    expect.objectContaining({ revision: 2 }),
    { payload: { description, title: finalTitle } },
  ]);
  expect(spies.approve).toHaveBeenCalledTimes(1);
  expect(spies.approve).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 3, payload: both.payload }),
  );
  expect(spies.patch.mock.invocationCallOrder[1]).toBeLessThan(
    spies.approve.mock.invocationCallOrder[0] ?? 0,
  );
});
it('CAPTURES-B10 when the first of two queued saves fails, the second is not sent, Approve stops and the failure is shown', async () => {
  page();
  const first = deferred();
  spies.patch.mockReturnValueOnce(first.promise);
  const card = cardOf(taskId) as HTMLElement;
  editTitle(card);
  const field = within(card).getByRole('textbox', { name: /Description/u });
  fireEvent.change(field, { target: { value: 'Bring the figures' } });
  fireEvent.blur(field);
  fireEvent.click(within(card).getByRole('button', { name: en.captures.approve }));
  await act(async () => first.reject(new Error('The server is not answering.')));
  expect(spies.patch).toHaveBeenCalledTimes(1);
  expect(spies.approve).not.toHaveBeenCalled();
  expect(within(card).getByRole('alert').textContent).toContain('The server is not answering.');
  // The next edit is a save of its own, not stuck behind the one that was never sent.
  await act(async () => editTitle(card));
  expect(spies.patch).toHaveBeenCalledTimes(2);
});
const readyButton = () =>
  screen.getByRole('button', {
    name: en.captures.approveReady.replace('{count, number, integer}', '1'),
  });
it('CAPTURES-B10 Approve N ready waits for an edit being saved, then approves from the list read again', async () => {
  page();
  const saving = deferred();
  spies.patch.mockReturnValue(saving.promise);
  spies.approveReady.mockResolvedValue({ data: { approved: [] } });
  editTitle(cardOf(taskId) as HTMLElement);
  const ready = readyButton();
  fireEvent.click(ready);
  expect(spies.approveReady).not.toHaveBeenCalled();
  expect(ready.getAttribute('aria-busy')).toBe('true');
  expect(ready.querySelector('.motion-safe\\:animate-spin')).toBeTruthy();
  // The save answers; the list as read again now holds the edited task and a second ready draft.
  spies.list = {
    data: [{ ...group, suggestions: [edited, secondTask] }],
    meta: { nextCursor: null },
  };
  await act(async () => saving.resolve({ data: edited }));
  expect(spies.approveReady).toHaveBeenCalledTimes(1);
  expect(spies.approveReady).toHaveBeenCalledWith([taskId, secondTaskId]);
  sentAfterPatch(spies.approveReady);
});
const plural = (message: string, count: number) =>
  message
    .match(new RegExp(`${count === 1 ? 'one' : 'other'} \\{([^}]*)\\}`, 'u'))?.[1]
    ?.replace('#', String(count));
const approvalOf = (suggestion: { id: string }) => ({
  suggestion: { ...suggestion, status: 'approved' },
  live: { type: 'task', id: suggestion.id },
});
const lastToast = () => spies.toast.mock.calls.at(-1)?.[0];
it('CAPTURES-B10 Approve N ready with nothing left to approve sends nothing, says so at high priority and focuses the draft', async () => {
  page();
  spies.patch.mockRejectedValue(new Error('The server is not answering.'));
  editTitle(cardOf(taskId) as HTMLElement);
  await act(async () => {
    fireEvent.click(readyButton());
  });
  expect(spies.approveReady).not.toHaveBeenCalled();
  expect(lastToast()).toEqual({ title: en.captures.noneApproved, priority: 'high' });
  expect(document.activeElement).toBe(cardOf(taskId));
});
it('CAPTURES-B10 Approve N ready approves the draft that saved, says the one whose save failed was left out, and focuses it', async () => {
  withDrafts(task, secondTask);
  page();
  spies.patch.mockRejectedValue(new Error('The server is not answering.'));
  spies.approveReady.mockResolvedValue({ data: { approved: [approvalOf(secondTask)] } });
  editTitle(cardOf(taskId) as HTMLElement);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {
        name: en.captures.approveReady.replace('{count, number, integer}', '2'),
      }),
    );
  });
  expect(spies.approveReady).toHaveBeenCalledTimes(1);
  expect(spies.approveReady).toHaveBeenCalledWith([secondTaskId]);
  const toast = lastToast();
  expect(toast.priority).toBe('high');
  expect(toast.title).toContain(plural(en.captures.skippedUnsaved, 1));
  expect(toast.title).not.toContain(plural(en.captures.skippedNotReady, 1));
  expect(document.activeElement).toBe(cardOf(taskId));
});
it('CAPTURES-B10 Approve N ready says a draft no longer ready after the list is read again stayed in Review', async () => {
  withDrafts(task, secondTask);
  page();
  spies.approveReady.mockResolvedValue({ data: { approved: [approvalOf(task)] } });
  const blocked = { ...secondTask, revision: 2, payload: { title: '', ownerId: null } };
  spies.list = { data: [{ ...group, suggestions: [task, blocked] }], meta: { nextCursor: null } };
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {
        name: en.captures.approveReady.replace('{count, number, integer}', '2'),
      }),
    );
  });
  expect(spies.approveReady).toHaveBeenCalledWith([taskId]);
  const toast = lastToast();
  expect(toast.priority).toBe('high');
  expect(toast.title).toContain(plural(en.captures.skippedNotReady, 1));
  expect(toast.title).not.toContain(plural(en.captures.skippedUnsaved, 1));
  expect(document.activeElement).toBe(cardOf(secondTaskId));
});
it('CAPTURES-B10 Approve N ready with nothing skipped keeps the receipt at its usual priority', async () => {
  withDrafts(task, secondTask);
  page();
  spies.approveReady.mockResolvedValue({
    data: { approved: [approvalOf(task), approvalOf(secondTask)] },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {
        name: en.captures.approveReady.replace('{count, number, integer}', '2'),
      }),
    );
  });
  expect(lastToast()).toMatchObject({ title: '2 drafts were approved.', priority: 'low' });
});
it('CAPTURES-B10 the Arabic lines for skipped drafts take every Arabic plural form, with Arabic digits', () => {
  // As the workspace's Arabic numerals setting configures `integer`.
  const t = createTranslator({
    locale: 'ar',
    messages: ar,
    namespace: 'captures',
    formats: { number: { integer: { numberingSystem: 'arab', maximumFractionDigits: 0 } } },
  });
  for (const key of ['skippedUnsaved', 'skippedNotReady'] as const) {
    expect(t(key, { count: 1 })).toContain('مسودة واحدة');
    expect(t(key, { count: 2 })).toContain('مسودتان');
    expect(t(key, { count: 3 })).toContain('٣ مسودات');
    expect(t(key, { count: 11 })).toContain('١١ مسودة');
    expect(t(key, { count: 100 })).toContain('١٠٠ مسودة');
  }
});
it('CAPTURES-B10 a receipt that names skipped drafts stays fifteen seconds; without them, and for Discard, five', () => {
  let toast: ReturnType<typeof useReviewToast> | undefined;
  function Probe() {
    toast = useReviewToast();
    return null;
  }
  mount(<Probe />);
  if (!toast) throw new Error('no toast');
  toast.approved(
    '1 draft was approved.',
    [approvalOf(task) as never],
    ['1 draft stayed in Review.'],
  );
  expect(lastToast()).toMatchObject({ priority: 'high', timeout: 15000 });
  toast.approved('1 draft was approved.', [approvalOf(task) as never]);
  expect(lastToast()).toMatchObject({ priority: 'low', timeout: 5000 });
  toast.discarded(taskId);
  expect(lastToast()).toMatchObject({ title: en.captures.discarded, timeout: 5000 });
});
it('CAPTURES-B01 drafts and the failed and unavailable boxes stand on a solid surface; the signal stays on the border', () => {
  const box = (status: string) =>
    CaptureGroup.parse({
      ...group,
      id: crypto.randomUUID(),
      transcript: null,
      status,
      errorCode: status === 'failed' ? 'provider_error' : null,
      suggestions: [],
    });
  spies.list = {
    data: [group, box('failed'), box('needs_transcript')],
    meta: { nextCursor: null },
  };
  page();
  for (const card of screen.getAllByTestId('suggestion-card')) {
    expect(card.className).toMatch(/\bbg-elevated\b/u);
    expect(card.className).not.toMatch(/\bbg-surface\b/u);
  }
  const failed = screen.getByText(en.captures.failedOther).closest('div');
  expect(failed?.className).toMatch(/\bbg-elevated\b/u);
  expect(failed?.className).toMatch(/\bborder\b.*\bborder-danger\b/u);
  const unavailable = screen.getByText(en.captures.unavailable).closest('div');
  expect(unavailable?.className).toMatch(/\bbg-elevated\b/u);
  expect(unavailable?.className).toMatch(/\bborder\b/u);
});

// S17 S29: deleting a recording from Review, with Undo.
const unavailableId = '01a08a9f-1991-760a-b73a-568f6f866610';
const failedId = '01a08a9f-1991-760a-b73a-568f6f866611';
const recording = (id: string, status: string, createdAt: string) =>
  CaptureGroup.parse({ ...group, id, status, createdAt, transcript: null, suggestions: [] });
const unavailable = recording(unavailableId, 'needs_transcript', '2026-09-10T05:40:00.000Z');
const failed = recording(failedId, 'failed', '2026-09-10T04:40:00.000Z');
const listOf = (...groups: object[]) => {
  spies.list = { data: groups, meta: { nextCursor: null } };
  for (const listener of spies.listeners) listener();
};
const groupOf = (id: string) => document.querySelector<HTMLElement>(`[data-capture="${id}"]`);
const opId = '01a08a9f-1991-760a-b73a-568f6f866699';
// The delete removes the group from the list as the server's re-read would.
function deletesFrom(...groups: { id: string }[]) {
  spies.removeCapture.mockImplementation(async (gone: string) => {
    listOf(...groups.filter((item) => item.id !== gone));
    return { opId };
  });
}
it('CAPTURES-B13 Delete recording is last on the needs_transcript and failed cards, after Retry and Type the transcript', () => {
  listOf(unavailable, failed);
  page();
  for (const id of [unavailableId, failedId]) {
    const names = within(groupOf(id) as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names.slice(-3)).toEqual([
      en.captures.retry,
      en.captures.typeTranscript,
      en.captures.deleteRecording,
    ]);
    const remove = within(groupOf(id) as HTMLElement).getByRole('button', {
      name: en.captures.deleteRecording,
    });
    expect(remove.className).toContain('text-danger');
    expect(remove.className).toContain('pointer-coarse:min-h-11');
    expect(remove.className).not.toContain('ms-auto');
    expect(remove.querySelector('svg')).toBeTruthy();
  }
});
it('CAPTURES-B13 a ready group offers Delete recording only behind More actions, never beside Approve; Escape returns focus to the trigger', async () => {
  page();
  const ready = groupOf(captureId) as HTMLElement;
  expect(within(ready).queryByRole('button', { name: en.captures.deleteRecording })).toBeNull();
  const more = within(ready).getByRole('button', { name: en.captures.moreActions });
  expect(more.className).toContain('pointer-coarse:size-11');
  expect(more.closest('header')).toBeTruthy();
  await act(async () => {
    more.focus();
    fireEvent.click(more);
  });
  const remove = await screen.findByRole('button', { name: en.captures.deleteRecording });
  expect(ready.contains(remove)).toBe(false);
  const menu = screen.getByTestId('capture-menu');
  // The opaque surface variant; its computed ground is checked in the browser (CAPTURES-A09).
  expect(menu.getAttribute('data-surface')).toBe('elevated');
  expect(menu.className).toMatch(/\bring-1\b/u);
  await act(async () => {
    remove.focus();
    fireEvent.keyDown(remove, { key: 'Escape' });
  });
  await vi.waitFor(() =>
    expect(screen.queryByRole('button', { name: en.captures.deleteRecording })).toBeNull(),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(more));
});
it('CAPTURES-B13 Delete acts at once with no confirm dialog and offers Undo for ten seconds', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  page();
  await act(async () => {
    fireEvent.click(
      within(groupOf(failedId) as HTMLElement).getByRole('button', {
        name: en.captures.deleteRecording,
      }),
    );
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(spies.removeCapture).toHaveBeenCalledWith(failedId);
  expect(lastToast()).toMatchObject({
    title: en.captures.recordingDeleted,
    priority: 'low',
    timeout: 10000,
    actionProps: { children: en.common.undo },
  });
  expect(groupOf(failedId)).toBeNull();
});
it('CAPTURES-B13 with approved records the receipt says they stay, and a new delete takes the previous receipt away', async () => {
  const approvedDraft = draft({ ...secondTask, status: 'approved' });
  const kept = CaptureGroup.parse({ ...group, suggestions: [task, approvedDraft] });
  listOf(kept, unavailable);
  deletesFrom(kept, unavailable);
  spies.toast.mockReturnValueOnce('first').mockReturnValueOnce('second');
  page();
  await act(async () => {
    fireEvent.click(
      within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
        name: en.captures.deleteRecording,
      }),
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.moreActions }));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: en.captures.deleteRecording }));
  });
  expect(lastToast()).toMatchObject({ title: en.captures.recordingDeletedApproved });
  expect(spies.close).toHaveBeenCalledWith('first');
  // The earlier delete stays done: nothing was restored.
  expect(spies.restoreCapture).not.toHaveBeenCalled();
});
it('CAPTURES-B13 after a delete focus goes to the next group heading, else the inbox heading', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  page();
  await act(async () => {
    fireEvent.click(
      within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
        name: en.captures.deleteRecording,
      }),
    );
  });
  expect(document.activeElement).toBe(document.getElementById(`capture-${failedId}`));
  deletesFrom(failed);
  await act(async () => {
    fireEvent.click(
      within(groupOf(failedId) as HTMLElement).getByRole('button', {
        name: en.captures.deleteRecording,
      }),
    );
  });
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  expect(document.activeElement).not.toBe(document.body);
});
it('CAPTURES-B13 Undo restores with the delete op id, says so for four seconds and focuses the group first action', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  spies.toast.mockReturnValue('deleted');
  // The restore answers first and the list renders it a tick later, as react-query does.
  spies.restoreCapture.mockImplementation(async () => {
    setTimeout(() => listOf(unavailable, failed), 0);
    return { data: unavailable };
  });
  page();
  await act(async () => {
    fireEvent.click(
      within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
        name: en.captures.deleteRecording,
      }),
    );
  });
  // The reader presses Undo in the toast, which is not rendered here: focus has left the list.
  (document.activeElement as HTMLElement | null)?.blur();
  await act(async () => {
    lastToast().actionProps.onClick();
  });
  expect(spies.restoreCapture).toHaveBeenCalledWith(unavailableId, opId);
  expect(spies.update).toHaveBeenLastCalledWith('deleted', {
    title: en.captures.recordingRestored,
    timeout: 4000,
    actionProps: { children: undefined },
  });
  await waitFor(() => expect(groupOf(unavailableId)).toBeTruthy());
  const restored = groupOf(unavailableId) as HTMLElement;
  // Back in its own place, before the older recording.
  expect(document.querySelectorAll('[data-capture]')[0]).toBe(restored);
  await waitFor(() => expect(document.activeElement).toBe(restored.querySelector('button')));
});
it('CAPTURES-B13 when Undo fails, or the list moves on without the recording, focus goes to the inbox heading', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  spies.toast.mockReturnValue('deleted');
  spies.restoreCapture.mockRejectedValueOnce(new Error('offline'));
  page();
  const remove = (id: string) =>
    act(async () => {
      fireEvent.click(
        within(groupOf(id) as HTMLElement).getByRole('button', {
          name: en.captures.deleteRecording,
        }),
      );
    });
  await remove(unavailableId);
  (document.activeElement as HTMLElement | null)?.blur();
  await act(async () => {
    lastToast().actionProps.onClick();
  });
  expect(spies.update).toHaveBeenLastCalledWith('deleted', {
    title: en.captures.restoreFailed,
    priority: 'high',
    timeout: 0,
    actionProps: { children: undefined },
  });
  const heading = screen.getByRole('heading', { level: 1 });
  expect(document.activeElement).toBe(heading);
  // A restore that answers but whose recording the next list does not hold (another filter).
  spies.restoreCapture.mockImplementation(async () => {
    setTimeout(() => listOf(failed), 0);
    return { data: unavailable };
  });
  (document.activeElement as HTMLElement | null)?.blur();
  await act(async () => {
    lastToast().actionProps.onClick();
  });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.activeElement).not.toBe(document.body);
});
it('CAPTURES-B13 a failed delete keeps the group and says so as an alert that stays until dismissed', async () => {
  listOf(unavailable);
  spies.removeCapture.mockRejectedValue(new Error('offline'));
  page();
  const remove = within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
    name: en.captures.deleteRecording,
  });
  await act(async () => {
    fireEvent.click(remove);
  });
  expect(lastToast()).toEqual({ title: en.captures.deleteFailed, priority: 'high', timeout: 0 });
  expect(groupOf(unavailableId)).toBeTruthy();
  expect(remove.hasAttribute('disabled')).toBe(false);
});
it('CAPTURES-B13 a group still processing offers Delete recording behind More actions, with the same Undo', async () => {
  const ids = [
    '01a08a9f-1991-760a-b73a-568f6f866620',
    '01a08a9f-1991-760a-b73a-568f6f866621',
    '01a08a9f-1991-760a-b73a-568f6f866622',
  ];
  const working = ['queued', 'transcribing', 'interpreting'].map((status, at) =>
    recording(ids[at] ?? '', status, `2026-09-10T0${3 - at}:40:00.000Z`),
  );
  listOf(...working);
  deletesFrom(...working);
  page();
  for (const item of working) {
    const card = groupOf(item.id) as HTMLElement;
    expect(within(card).queryByRole('button', { name: en.captures.deleteRecording })).toBeNull();
    expect(within(card).getByRole('button', { name: en.captures.moreActions })).toBeTruthy();
  }
  const [first, second] = working;
  if (!first || !second) throw new Error('no groups');
  await act(async () => {
    fireEvent.click(
      within(groupOf(first.id) as HTMLElement).getByRole('button', {
        name: en.captures.moreActions,
      }),
    );
  });
  const items = within(screen.getByTestId('capture-menu')).getAllByRole('button');
  expect(items.at(-1)?.textContent).toBe(en.captures.deleteRecording);
  await act(async () => {
    fireEvent.click(items.at(-1) as HTMLElement);
  });
  expect(spies.removeCapture).toHaveBeenCalledWith(first.id);
  expect(lastToast()).toMatchObject({ title: en.captures.recordingDeleted, timeout: 10000 });
  expect(groupOf(first.id)).toBeNull();
  expect(document.activeElement).toBe(document.getElementById(`capture-${second.id}`));
});
it('CAPTURES-B13 in Arabic the recover card and the ready group menu use the approved copy', async () => {
  listOf(group, unavailable);
  page('ar');
  expect(
    within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
      name: ar.captures.deleteRecording,
    }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: ar.captures.moreActions })).toBeTruthy();
  expect(ar.captures.moreActions).toBe('إجراءات أخرى');
  expect(ar.captures.recordingDeleted).toBe('حُذف التسجيل');
  expect(ar.captures.recordingRestored).toBe('استُعيد التسجيل');
  expect(ar.common.undo).toBe('تراجع');
});
it('CAPTURES-B13 a recording restored after its job ended says processing stopped when it was deleted, in en and ar', () => {
  const interrupted = CaptureGroup.parse({ ...failed, errorCode: 'interrupted' });
  listOf(interrupted);
  page();
  expect(
    within(groupOf(failedId) as HTMLElement).getByText(en.captures.failedInterrupted),
  ).toBeTruthy();
  page('ar');
  expect(screen.getByText(ar.captures.failedInterrupted)).toBeTruthy();
  expect(ar.captures.failedInterrupted).toBe(
    'توقفت المعالجة عند حذف هذا التسجيل. أعد المحاولة لإعداد مسوداته.',
  );
});
// The restore answers, and the list is re-read only when the scenario says so.
function restoresLater(...groups: object[]) {
  let relist = () => {};
  spies.restoreCapture.mockImplementation(async () => {
    relist = () => listOf(...groups);
    return { data: unavailable };
  });
  return () => act(async () => relist());
}
const deleteThenUndo = async () => {
  await act(async () => {
    fireEvent.click(
      within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
        name: en.captures.deleteRecording,
      }),
    );
  });
  await act(async () => {
    lastToast().actionProps.onClick();
  });
};
const retryOf = (id: string) =>
  within(groupOf(id) as HTMLElement).getByRole('button', { name: en.captures.retry });
it('CAPTURES-B13 after Undo, focus the reader moved before the list re-rendered stays where they put it', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  spies.toast.mockReturnValue('deleted');
  const relist = restoresLater(unavailable, failed);
  page();
  await deleteThenUndo();
  const retry = retryOf(failedId);
  retry.focus();
  await relist();
  expect(groupOf(unavailableId)).toBeTruthy();
  expect(document.activeElement).toBe(retry);
  // The waiting focus was used up: a later render of the group does not take it either.
  await act(async () => listOf(unavailable, failed));
  expect(document.activeElement).toBe(retry);
});
it('CAPTURES-B13 the heading fallback leaves focus the reader moved, for a failed Undo and a list without the recording', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  spies.toast.mockReturnValue('deleted');
  spies.restoreCapture.mockRejectedValueOnce(new Error('offline'));
  page();
  await deleteThenUndo();
  // The rejection lands after the reader has moved on.
  expect(document.activeElement).toBe(document.getElementById(`capture-${failedId}`));
  const retry = retryOf(failedId);
  retry.focus();
  await act(async () => {
    lastToast().actionProps.onClick();
  });
  expect(document.activeElement).toBe(retry);
  const relist = restoresLater(failed);
  await act(async () => {
    lastToast().actionProps.onClick();
  });
  await relist();
  expect(document.activeElement).toBe(retry);
});
it('CAPTURES-B13 a waiting focus goes with the inbox: a later inbox that lists the recording does not jump to it', async () => {
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  spies.toast.mockReturnValue('deleted');
  const relist = restoresLater(unavailable, failed);
  page();
  await deleteThenUndo();
  cleanup();
  await relist();
  page();
  const restored = groupOf(unavailableId) as HTMLElement;
  expect(restored).toBeTruthy();
  expect(document.activeElement).not.toBe(restored.querySelector('button'));
});
// A restore still in flight when the inbox that started it goes (a link, Back) moves no focus when
// it answers, in the inbox the reader comes back to.
const undoHeld = async () => {
  const restore = deferred();
  spies.restoreCapture.mockReturnValue(restore.promise);
  listOf(unavailable, failed);
  deletesFrom(unavailable, failed);
  spies.toast.mockReturnValue('deleted');
  page();
  await deleteThenUndo();
  cleanup();
  return restore;
};
it('CAPTURES-B13 a restore that answers after its inbox has gone does not focus the recording in a later inbox', async () => {
  const restore = await undoHeld();
  await act(async () => {
    listOf(unavailable, failed);
    restore.resolve({ data: unavailable });
  });
  page();
  const play = within(groupOf(unavailableId) as HTMLElement).getByRole('button', {
    name: en.captures.playRecording,
  });
  expect(document.activeElement).not.toBe(play);
});
it('CAPTURES-B13 a restore that fails after its inbox has gone does not focus a later inbox heading', async () => {
  const restore = await undoHeld();
  page();
  await act(async () => {
    restore.reject(new Error('offline'));
  });
  expect(spies.update).toHaveBeenLastCalledWith(
    'deleted',
    expect.objectContaining({ title: en.captures.restoreFailed }),
  );
  expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
});
