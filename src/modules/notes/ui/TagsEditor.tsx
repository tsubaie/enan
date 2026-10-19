'use client';
import type { ReactNode } from 'react';
import { TagsEditor as SharedTagsEditor } from '@/ui/tags/TagsEditor';
import { useTags } from './queries';
// NOTES-B13: the shared tag field, offering the tags already used on notes (NOTES-I03 caps a note
// at ten, which the shared field enforces). `action` holds the tag suggestion wand (NOTES-B22).
export function TagsEditor({
  tags,
  save,
  action,
}: {
  tags: string[];
  save: (tags: string[]) => void;
  action?: ReactNode;
}) {
  const query = useTags();
  return (
    <SharedTagsEditor
      tags={tags}
      save={save}
      action={action}
      suggestions={{ tags: query.data?.data ?? [], refresh: () => void query.refetch() }}
    />
  );
}
