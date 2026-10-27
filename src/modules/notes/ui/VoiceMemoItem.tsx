'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Chip } from '@/ui/entity/Card';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import type { AiReview } from '@/ui/ai/queries';
import type { NoteDetail, NoteVoiceMemo } from '../schema/validation';
import { useVoiceMutations } from './voice-queries';
import { VoiceMemoPlayer } from './VoiceMemoPlayer';
import { VoiceMemoReview, type Run } from './VoiceMemoReview';
// NOTES-B30, B31: one memo — its player, its transcription state and its review card.
export function VoiceMemoItem({
  note,
  memo,
  review,
}: {
  note: NoteDetail;
  memo: NoteVoiceMemo;
  review: AiReview;
}) {
  const t = useTranslations('notes');
  const c = useTranslations('common');
  const mutations = useVoiceMutations();
  const [error, setError] = useState<Error | null>(null);
  const status = {
    pending: t('voicePending'),
    done: t('voiceDone'),
    failed: t('voiceFailed'),
    skipped: t('voiceSkipped'),
  }[memo.transcriptionStatus];
  const run: Run = (action) => {
    setError(null);
    action().catch((failure: unknown) =>
      setError(failure instanceof Error ? failure : new Error(c('error'))),
    );
  };
  return (
    <li className="grid gap-3 rounded-xl border bg-bg/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="auto" className="min-w-0 truncate text-sm font-medium">
          {memo.originalName}
        </span>
        <Chip>{status}</Chip>
      </div>
      <VoiceMemoPlayer memo={memo} remove={() => run(() => mutations.remove(note.id, memo.id))} />
      {error && <ErrorPanel error={error} />}
      <VoiceMemoReview note={note} memo={memo} review={review} run={run} />
    </li>
  );
}
