'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request, upload } from '@/core/http/client';
import { NoteDetail } from '../schema/validation';
const response = z.object({ data: NoteDetail });
// NOTES-B29–B31, B36: a voice memo's upload, removal and transcript, and a recording that becomes
// a new note, each refreshing the notes. A transcribe that also refines refreshes the AI job,
// whose result the Brief tab shows.
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
    // The new note is seeded in the cache, so opening it right after shows it at once.
    createFromVoice: (form: FormData) =>
      write(async () => {
        const created = await upload('/notes/voice', response, form);
        client.setQueryData(['notes', 'detail', created.data.id, false], created.data);
        return created;
      }),
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
  return useVoiceSave((form) => mutations.upload(noteId, form), fallback);
}
// NOTES-B36: the same, for a recording that becomes a new note; `attach` answers with that note.
export function useVoiceCreate(fields: Record<string, string | null>, fallback: string) {
  const mutations = useVoiceMutations();
  return useVoiceSave((form) => {
    for (const [key, value] of Object.entries(fields)) if (value) form.set(key, value);
    return mutations.createFromVoice(form);
  }, fallback);
}
function useVoiceSave(send: (form: FormData) => Promise<NoteDetail>, fallback: string) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function attach(file: File, seconds: number) {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    form.set('durationSeconds', String(Math.min(Math.round(seconds), 900)));
    try {
      return await send(form);
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(fallback));
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, attach };
}
