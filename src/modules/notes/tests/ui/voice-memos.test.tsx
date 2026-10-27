// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { NoteDetail, RefinementOutput } from '../../schema/validation';
import { NoteVoiceMemos } from '../../ui/NoteVoiceMemos';
import { mount } from './harness';
const spies = vi.hoisted(() => ({
  attach: vi.fn(),
  transcribe: vi.fn(),
  remove: vi.fn(),
  patch: vi.fn(),
  createTask: vi.fn(),
  review: {} as object,
}));
vi.mock('@/ui/ai/queries', () => ({ useAiReview: () => spies.review }));
vi.mock('../../ui/voice-queries', () => ({
  useVoiceUpload: () => ({ saving: false, error: null, attach: spies.attach }),
  useVoiceMutations: () => ({ transcribe: spies.transcribe, remove: spies.remove }),
}));
const ownerId = '01a08a9f-1991-760a-b73a-568f6f866540';
vi.mock('../../ui/queries', () => ({
  useNoteMutations: () => ({ patch: spies.patch }),
  useAllPeople: () => ({
    data: {
      data: [{ id: ownerId, fullName: 'Finance Lead', displayName: null, isAssignable: true }],
    },
  }),
}));
vi.mock('@/modules/tasks/ui', () => ({ useTaskMutations: () => ({ create: spies.createTask }) }));
const noteId = '01a08a9f-1991-760a-b73a-568f6f86653b';
const memoId = '01a08a9f-1991-760a-b73a-568f6f866541';
const memo = (fields: object = {}) => ({
  id: memoId,
  noteId,
  fileId: '01a08a9f-1991-760a-b73a-568f6f866542',
  originalName: 'Board debrief.webm',
  mime: 'audio/webm',
  sizeBytes: 2048,
  durationSeconds: 74,
  transcript: null,
  transcriptionStatus: 'skipped',
  transcriptionJobId: null,
  transcriptionError: null,
  audioUrl: `/api/v1/notes/${noteId}/voice/${memoId}/audio`,
  createdAt: '2026-09-10T08:00:00.000Z',
  createdBy: null,
  ...fields,
});
const noteWith = (fields: object = {}) =>
  NoteDetail.parse({
    id: noteId,
    revision: 3,
    title: 'Board debrief',
    content: 'Opening remarks',
    type: null,
    noteDate: '2026-09-10',
    tags: [],
    archivedAt: null,
    createdAt: '2026-09-10T07:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedOpId: null,
    ...fields,
  });
const brief = RefinementOutput.parse({
  refined_content: '## Decisions\n\n- Hire two analysts',
  suggested_tasks: [
    {
      title: 'Send the deck',
      description: null,
      status: 'next_action',
      priority: 'high',
      due_date: '2026-09-14',
      owner_name: 'Finance Lead',
      source_snippet: null,
    },
  ],
  suggested_tags: [],
  summary_of_changes: 'Grouped the decisions.',
});
const review = (job: object | null = null) => ({ enabled: true, pending: false, job });
const finished = {
  id: 'job-1',
  status: 'succeeded',
  revision: 3,
  result: { output: brief, warnings: [] },
};
// The browser's recorder, analyser, frame clock and wake lock, stood in for so the recorder's
// own wiring is what runs.
const media = vi.hoisted(() => ({
  frames: [] as FrameRequestCallback[],
  reduced: false,
  stop: vi.fn(),
  release: vi.fn(async () => {}),
  recorder: null as null | { state: string },
}));
class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: object, options: { mimeType?: string }) {
    this.mimeType = options.mimeType ?? '';
    media.recorder = this;
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['spoken words']) });
    this.onstop?.();
  }
}
class FakeContext {
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 64,
      getByteFrequencyData: (data: Uint8Array) => data.fill(255),
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  close = async () => {};
}
beforeEach(() => {
  for (const spy of [spies.attach, spies.transcribe, spies.remove, spies.patch, spies.createTask])
    spy.mockReset().mockResolvedValue({});
  spies.review = review();
  media.frames = [];
  media.reduced = false;
  media.stop.mockReset();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('matchMedia', () => ({ matches: media.reduced }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    media.frames.push(callback),
  );
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: media.stop }] }) },
  });
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: async () => ({ release: media.release, addEventListener: () => {} }) },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function startRecording() {
  mount(<NoteVoiceMemos note={noteWith()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Record voice memo' }));
  return screen.findByRole('form', { name: 'Voice recorder' });
}
describe('voice memo recorder', () => {
  it('NOTES-B34 shows the live 24-bar meter, keeps the screen awake and pauses, resumes and attaches by key', async () => {
    const bar = await startRecording();
    expect(await screen.findByText('WakeLock: Active')).toBeTruthy();
    expect(screen.getByText('00:00 / 15:00')).toBeTruthy();
    const bars = [...screen.getByTestId('voice-meter').children];
    expect(bars).toHaveLength(24);
    act(() => media.frames.shift()?.(0));
    expect(bars.every((item) => (item as HTMLElement).style.transform === 'scaleY(1)')).toBe(true);
    expect(document.activeElement).toBe(bar);
    fireEvent.keyDown(bar, { key: ' ' });
    expect(within(bar).getByRole('status').textContent).toBe('Paused');
    expect(media.recorder?.state).toBe('paused');
    expect(within(bar).getByRole('button', { name: 'Resume' })).toBeTruthy();
    fireEvent.keyDown(bar, { key: ' ' });
    expect(within(bar).getByRole('status').textContent).toBe('Recording');
    expect(spies.attach).not.toHaveBeenCalled();
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(spies.attach).toHaveBeenCalledTimes(1);
    const [file, seconds] = spies.attach.mock.calls[0] ?? [];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('Voice memo.webm');
    expect(seconds).toBe(0);
    expect(media.stop).toHaveBeenCalled();
    expect(media.release).toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: 'Voice recorder' })).toBeNull();
  });
  it('NOTES-B34 Escape cancels the recording and attaches nothing', async () => {
    const bar = await startRecording();
    fireEvent.keyDown(bar, { key: 'Escape' });
    expect(screen.queryByRole('form', { name: 'Voice recorder' })).toBeNull();
    expect(spies.attach).not.toHaveBeenCalled();
    expect(media.stop).toHaveBeenCalled();
  });
  it('NOTES-B34 Stop & Attach attaches what was said; with less motion asked for the bars stand still', async () => {
    media.reduced = true;
    const bar = await startRecording();
    expect(media.frames).toEqual([]);
    fireEvent.click(within(bar).getByRole('button', { name: 'Stop & Attach' }));
    expect(spies.attach).toHaveBeenCalledTimes(1);
  });
});
describe('voice memo player and upload', () => {
  it('NOTES-B29 a chosen audio file is attached as it is', () => {
    mount(<NoteVoiceMemos note={noteWith()} />);
    const file = new File(['ID3'], 'Call.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByTestId('voice-file'), { target: { files: [file] } });
    expect(spies.attach).toHaveBeenCalledWith(file, 0);
  });
  it('NOTES-B30 plays, seeks, steps 1x, 1.5x and 2x, downloads and deletes', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    mount(<NoteVoiceMemos note={noteWith({ voiceMemos: [memo()] })} />);
    expect(screen.getByText('No transcript')).toBeTruthy();
    const audio = document.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe(memo().audioUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalled();
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
      target: { value: '30' },
    });
    expect(audio?.currentTime).toBe(30);
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1x' }));
    expect(audio?.playbackRate).toBe(1.5);
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1.5x' }));
    expect(audio?.playbackRate).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 2x' }));
    expect(audio?.playbackRate).toBe(1);
    expect(screen.getByRole('link', { name: 'Download audio' }).getAttribute('download')).toBe(
      'Board debrief.webm',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete voice memo' }));
    expect(spies.remove).toHaveBeenCalledWith(noteId, memoId);
  });
});
describe('voice memo review card', () => {
  it('NOTES-B31 shows the transcript without touching the note until Insert into Note is pressed', () => {
    const transcript = 'Hire two analysts.';
    mount(
      <NoteVoiceMemos
        note={noteWith({ voiceMemos: [memo({ transcript, transcriptionStatus: 'done' })] })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Verbatim Transcript' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText(transcript)).toBeTruthy();
    expect(spies.transcribe).not.toHaveBeenCalled();
    expect(spies.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Insert into Note' }));
    expect(spies.transcribe).toHaveBeenCalledWith(noteId, memoId, { appendToNote: true });
    fireEvent.click(screen.getByRole('button', { name: 'Refine with AI' }));
    expect(spies.transcribe).toHaveBeenLastCalledWith(noteId, memoId, {
      appendToNote: true,
      refine: true,
    });
  });
  it('NOTES-B31 a transcript already in the note is not inserted twice, and refining does not append it again', () => {
    const transcript = 'Hire two analysts.';
    const note = noteWith({
      content: `Opening\n\n${transcript}`,
      voiceMemos: [memo({ transcript, transcriptionStatus: 'done' })],
    });
    mount(<NoteVoiceMemos note={note} />);
    const inserted = screen.getByRole('button', { name: 'In the note' });
    expect(inserted).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Refine with AI' }));
    expect(spies.transcribe).toHaveBeenCalledWith(noteId, memoId, {
      appendToNote: false,
      refine: true,
    });
  });
  it('NOTES-B31 with no transcript the reader can paste one, which is saved on the memo only', () => {
    mount(<NoteVoiceMemos note={noteWith({ voiceMemos: [memo()] })} />);
    expect(screen.getByRole('button', { name: 'Insert into Note' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Verbatim Transcript' }), {
      target: { value: '  Call the auditors.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }));
    expect(spies.transcribe).toHaveBeenCalledWith(noteId, memoId, {
      transcript: 'Call the auditors.',
    });
  });
  it('NOTES-B31 the brief tab shows the refinement and inserts it after the note’s own text, never over it', () => {
    spies.review = review(finished);
    mount(
      <NoteVoiceMemos
        note={noteWith({
          voiceMemos: [memo({ transcript: 'Words', transcriptionStatus: 'done' })],
        })}
      />,
    );
    expect(
      screen.getByRole('button', { name: '✨ AI Executive Brief' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('heading', { name: 'Decisions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Insert into Note' }));
    expect(spies.patch).toHaveBeenCalledWith(
      noteId,
      3,
      { content: `Opening remarks\n\n${brief.refined_content}` },
      expect.any(String),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verbatim Transcript' }));
    expect(screen.getByText('Words')).toBeTruthy();
  });
  it('NOTES-B35 an action item becomes a linked task with its matched owner in one press', () => {
    spies.review = review(finished);
    mount(
      <NoteVoiceMemos
        note={noteWith({
          voiceMemos: [memo({ transcript: 'Words', transcriptionStatus: 'done' })],
        })}
      />,
    );
    expect(screen.getByText('@Finance Lead')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(spies.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Send the deck',
        status: 'next_action',
        priority: 'high',
        dueDate: '2026-09-14',
        sourceNoteId: noteId,
        ownerId,
      }),
    );
  });
  it('NOTES-B35 an action item already on the note shows as created', () => {
    spies.review = review(finished);
    const task = {
      id: '01a08a9f-1991-760a-b73a-568f6f866543',
      revision: 1,
      title: 'Send the deck',
      status: 'next_action',
      priority: 'high',
      dueDate: null,
      completedAt: null,
      ownerName: 'Finance Lead',
    };
    mount(
      <NoteVoiceMemos
        note={noteWith({ tasks: [task], voiceMemos: [memo({ transcript: 'Words' })] })}
      />,
    );
    expect(screen.getByText('Task created')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull();
  });
});
