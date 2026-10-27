'use client';
import { useTranslations } from 'next-intl';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { useAiReview } from '@/ui/ai/queries';
import type { NoteDetail } from '../schema/validation';
import { useVoiceUpload } from './voice-queries';
import { useVoiceRecorder } from './use-voice-recorder';
import { VoiceCapture, VoiceRecorderBar, recordingFile } from './VoiceCapture';
import { VoiceMemoItem } from './VoiceMemoItem';
const maxPerNote = 20;
// NOTES-B29, B34: record or upload a voice memo. The audio is saved the moment recording stops,
// before anything else; the transcript and the brief are proposals the reader inserts (B31).
export function NoteVoiceMemos({ note }: { note: NoteDetail }) {
  const t = useTranslations('notes');
  const review = useAiReview('notes.refine', note.id, note.revision, `/notes/${note.id}/refine`);
  const upload = useVoiceUpload(note.id, t('voiceSaveFailed'));
  const recorder = useVoiceRecorder((recording) => {
    void upload.attach(recordingFile(recording, t('voiceMemoFile')), recording.seconds);
  });
  const blocked = upload.saving || note.voiceMemos.length >= maxPerNote;
  return (
    <section className="mt-8 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('voiceMemos')}</h3>
        {recorder.state === 'idle' && (
          <VoiceCapture
            disabled={blocked}
            record={recorder.start}
            pick={(file, seconds) => void upload.attach(file, seconds)}
          />
        )}
      </div>
      <p className="text-xs text-text-muted">{t('voiceReassurance')}</p>
      {recorder.state !== 'idle' && <VoiceRecorderBar recorder={recorder} />}
      {upload.saving && (
        <p role="status" className="text-sm text-text-muted">
          {t('voiceSaving')}
        </p>
      )}
      {recorder.error && <ErrorPanel error={new Error(t('microphoneDenied'))} />}
      {upload.error && <ErrorPanel error={upload.error} />}
      {note.voiceMemos.length > 0 && (
        <ul className="grid gap-3">
          {note.voiceMemos.map((memo) => (
            <VoiceMemoItem key={memo.id} note={note} memo={memo} review={review} />
          ))}
        </ul>
      )}
    </section>
  );
}
