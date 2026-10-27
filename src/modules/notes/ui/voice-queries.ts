'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request, upload } from '@/core/http/client';
import { NoteDetail } from '../schema/validation';
const response = z.object({ data: NoteDetail });
// NOTES-B29–B31: a voice memo's upload, removal and transcript, each refreshing the notes. A
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
    upload: (noteId: string, form: FormData) =>
      write(() => upload(`/notes/${noteId}/voice`, response, form)),
    remove: (noteId: string, memoId: string) =>
      write(() => request(`/notes/${noteId}/voice/${memoId}`, response, { method: 'DELETE' })),
    transcribe: (
      noteId: string,
      memoId: string,
      body: { transcript?: string; appendToNote?: boolean; refine?: boolean },
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
// Saving a recording or a chosen file: whether one is on its way, and why the last one failed.
export function useVoiceUpload(noteId: string, fallback: string) {
  const mutations = useVoiceMutations();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function attach(file: File, seconds: number) {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    form.set('durationSeconds', String(Math.min(Math.round(seconds), 900)));
    try {
      await mutations.upload(noteId, form);
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(fallback));
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, attach };
}
