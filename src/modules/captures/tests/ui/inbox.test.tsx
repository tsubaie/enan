// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { CaptureGroup } from '../../schema/validation';
import { CapturesPage } from '../../ui/CapturesPage';
import { mount } from '../../../../../tests/fixtures/mount';
// CAPTURES-B08 CAPTURES-B09 CAPTURES-B10: the inbox as the page renders it, with the review
// actions as spies; nothing reaches a server.
const spies = vi.hoisted(() => ({
  patch: vi.fn(),
  approve: vi.fn(),
  approveReady: vi.fn(),
  discard: vi.fn(),
  undo: vi.fn(),
  toast: vi.fn(),
  list: { data: [] as object[], meta: { nextCursor: null } },
}));
vi.mock('../../ui/capture-queries', () => ({
  useCaptures: () => ({ data: spies.list, isPending: false, error: null }),
  useReviewMutations: () => ({
    patch: spies.patch,
    approve: spies.approve,
    approveReady: spies.approveReady,
    discard: spies.discard,
    undo: spies.undo,
    merge: vi.fn(),
    typeTranscript: vi.fn(),
  }),
  useAssignablePeople: () => [
    { id: '01a08a9f-1991-760a-b73a-568f6f8665a1', fullName: 'Finance Lead', displayName: null },
  ],
  useRetryCapture: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRemoveCapture: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
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
  useToastManager: () => ({ add: spies.toast, update: vi.fn() }),
}));
const captureId = '01a08a9f-1991-760a-b73a-568f6f866600';
const transcript =
  'Send the updated supplier quote before Thursday. And a note for the projects committee: review the timeline.';
const sentence = 'And a note for the projects committee: review the timeline.';
const draft = (fields: object) => ({
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
  for (const spy of [spies.patch, spies.approve, spies.approveReady, spies.discard, spies.toast])
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
