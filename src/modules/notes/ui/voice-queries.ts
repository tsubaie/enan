'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useAiCapable } from '@/ui/ai/queries';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { NoteDetail } from '../schema/validation';
const response = z.object({ data: NoteDetail });
// NOTES-B30, B31: an existing voice memo's removal and transcript, each refreshing the notes. A
// transcribe that also refines refreshes the AI job, whose result the Brief tab shows.
export function useVoiceMutations() {
  const client = useQueryClient();
  const refresh = (keys: string[]) =>
    Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
  async function write(action: () => Promise<z.infer<typeof response>>, keys = ['notes']) {
    try {
      return (await action()).data;
    } finally {
      await refresh(keys);
    }
  }
  return {
    remove: (noteId: string, memoId: string) =>
      write(() => request(`/notes/${noteId}/voice/${memoId}`, response, { method: 'DELETE' })),
    transcribe: (
      noteId: string,
      memoId: string,
      body: { transcript?: string; appendToNote?: boolean; refine?: boolean; ai?: boolean },
    ) =>
      write(
        () =>
          request(`/notes/${noteId}/voice/${memoId}/transcribe`, response, {
            method: 'POST',
            body,
          }),
        body.refine ? ['notes', 'ai'] : ['notes'],
      ),
  };
}
// NOTES-B37: whether AI can transcribe a recording now.
export const useTranscribeAvailable = () => useAiCapable('notes.transcribe');
