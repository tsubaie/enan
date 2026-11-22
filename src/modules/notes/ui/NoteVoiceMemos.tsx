'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useAiReview } from '@/ui/ai/queries';
import type { NoteDetail } from '../schema/validation';
import { VoiceMemoItem } from './VoiceMemoItem';
// NOTES-B30, B31 (CAPTURES-B06): the memos a note already has: playback, download, removal and
// their transcript. New audio arrives through a voice capture, never onto a note (CAPTURES-B05).
export function NoteVoiceMemos({ note }: { note: NoteDetail }) {
  const t = useTranslations('notes');
  const review = useAiReview('notes.refine', note.id, note.revision, `/notes/${note.id}/refine`);
  const client = useQueryClient();
  const finished = review.job?.status === 'succeeded' ? review.job.id : null;
  // sync: the server's refine job; once it has finished, the note is read again.
  useEffect(() => {
    if (finished) void client.invalidateQueries({ queryKey: ['notes', 'detail', note.id] });
  }, [finished, client, note.id]);
  if (!note.voiceMemos.length) return null;
  return (
    <section className="mt-8 grid gap-2">
      <h3 className="text-sm font-medium">{t('voiceMemos')}</h3>
      <ul className="grid gap-3">
        {note.voiceMemos.map((memo) => (
          <VoiceMemoItem key={memo.id} note={note} memo={memo} review={review} />
        ))}
      </ul>
    </section>
  );
}
