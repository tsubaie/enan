'use client';
import { useTranslations } from 'next-intl';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { useVoiceCreate } from './voice-queries';
import { useVoiceRecorder } from './use-voice-recorder';
import { VoiceCapture, VoiceRecorderBar, recordingFile } from './VoiceCapture';
// NOTES-B36: record first, and the note follows. One press records (or picks a file); the audio
// is saved as a new note the moment recording stops, and that note opens.
export function QuickVoiceNoteBar({
  committeeId = null,
  type = null,
  onCreated,
}: {
  committeeId?: string | null;
  type?: string | null;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('notes');
  const save = useVoiceCreate({ committeeId, type }, t('voiceSaveFailed'));
  async function keep(file: File, seconds: number) {
    const created = await save.attach(file, seconds);
    if (created) onCreated(created.id);
  }
  const recorder = useVoiceRecorder((recording) => {
    void keep(recordingFile(recording, t('voiceMemoFile')), recording.seconds);
  });
  return (
    <div
      role="group"
      aria-label={t('quickVoiceLabel')}
      className="grid gap-2 rounded-xl border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">{t('quickVoiceHint')}</p>
        {recorder.state === 'idle' && (
          <VoiceCapture
            disabled={save.saving}
            record={recorder.start}
            pick={(file, seconds) => void keep(file, seconds)}
          />
        )}
      </div>
      {recorder.state !== 'idle' && <VoiceRecorderBar recorder={recorder} />}
      {save.saving && (
        <p role="status" className="text-sm text-text-muted">
          {t('voiceSaving')}
        </p>
      )}
      {recorder.error && <ErrorPanel error={new Error(t('microphoneDenied'))} />}
      {save.error && <ErrorPanel error={save.error} />}
    </div>
  );
}
