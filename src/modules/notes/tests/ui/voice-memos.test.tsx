// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { NoteDetail, RefinementOutput } from '../../schema/validation';
import { NoteVoiceMemos } from '../../ui/NoteVoiceMemos';
import en from '@/core/i18n/messages/en.json';
import { mount } from './harness';
const spies = vi.hoisted(() => ({
  attach: vi.fn(),
  transcribe: vi.fn(),
  remove: vi.fn(),
  patch: vi.fn(),
  createTask: vi.fn(),
  createFromVoice: vi.fn(),
  transcribeAvailable: vi.fn(() => false),
  review: {} as object,
}));
vi.mock('@/ui/ai/queries', () => ({ useAiReview: () => spies.review }));
vi.mock('../../ui/voice-queries', () => ({
  useVoiceMutations: () => ({ transcribe: spies.transcribe, remove: spies.remove }),
  useTranscribeAvailable: () => spies.transcribeAvailable(),
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
  spies.createFromVoice.mockReset().mockResolvedValue({ id: noteId });
  spies.transcribeAvailable.mockReset().mockReturnValue(false);
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
describe('voice memo player', () => {
  it('CAPTURES-B05 a note offers no way to record or upload audio, and one without memos shows nothing', () => {
    const { container } = mount(<NoteVoiceMemos note={noteWith()} />);
    expect(container.textContent).toBe('');
    mount(<NoteVoiceMemos note={noteWith({ voiceMemos: [memo()] })} />);
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
  it('CAPTURES-B06 NOTES-B30 an existing memo plays, seeks, steps 1x, 1.5x and 2x, downloads and deletes', () => {
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
  it('NOTES-B37 a memo AI is transcribing says so, and a failed one offers Transcribe with AI again', () => {
    mount(
      <NoteVoiceMemos
        note={noteWith({ voiceMemos: [memo({ transcriptionStatus: 'pending' })] })}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(en.notes.voiceTranscribingHint);
    expect(screen.queryByRole('textbox', { name: 'Verbatim Transcript' })).toBeNull();
    spies.transcribeAvailable.mockReturnValue(true);
    mount(
      <NoteVoiceMemos note={noteWith({ voiceMemos: [memo({ transcriptionStatus: 'failed' })] })} />,
    );
    expect(screen.getByText(en.notes.voiceFailedHint)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.notes.transcribeVoice }));
    expect(spies.transcribe).toHaveBeenCalledWith(noteId, memoId, { ai: true });
    // Typing it in stays possible.
    expect(screen.getByRole('textbox', { name: 'Verbatim Transcript' })).toBeTruthy();
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
