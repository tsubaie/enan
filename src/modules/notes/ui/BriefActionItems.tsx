'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Chip } from '@/ui/entity/Card';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { useTaskMutations } from '@/modules/tasks/ui';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import type { NoteDetail, SuggestedTask } from '../schema/validation';
import { useAllPeople } from './queries';
type Item = z.infer<typeof SuggestedTask>;
// The owner is the one assignable person the brief named, as when a refinement is applied.
function useCreateTask(noteId: string, fallback: string) {
  const people = useAllPeople();
  const mutations = useTaskMutations();
  const [error, setError] = useState<Error | null>(null);
  const ownerId = (name: string | null) => {
    const matches = (people.data?.data ?? []).filter(
      (person) => person.isAssignable && (person.displayName ?? person.fullName) === name,
    );
    return matches.length === 1 ? (matches[0]?.id ?? null) : null;
  };
  async function create(task: Item) {
    setError(null);
    try {
      await mutations.create(
        TaskCreate.parse({
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.due_date,
          sourceNoteId: noteId,
          ownerId: ownerId(task.owner_name),
        }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(fallback));
    }
  }
  return { create, error };
}
// NOTES-B35: each action item the brief found becomes a linked task in one press; one already on
// the note (by its title) shows as created instead.
export function BriefActionItems({ note, tasks }: { note: NoteDetail; tasks: Item[] }) {
  const t = useTranslations('notes');
  const c = useTranslations('common');
  const { create, error } = useCreateTask(note.id, c('error'));
  if (!tasks.length) return null;
  return (
    <section className="grid gap-1">
      <h4 className="text-xs font-medium text-text-muted">{t('actionItems')}</h4>
      {error && <ErrorPanel error={error} />}
      <ul className="divide-y divide-border/70">
        {tasks.map((task) => (
          <li key={task.title} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            <span dir="auto" className="min-w-0 flex-1">
              {task.title}
            </span>
            {task.owner_name && (
              <Chip>
                <bdi>@{task.owner_name}</bdi>
              </Chip>
            )}
            {note.tasks.some((item) => item.title === task.title) ? (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="size-3.5" aria-hidden />
                {t('taskCreated')}
              </span>
            ) : (
              <Button size="xs" variant="secondary" onClick={() => void create(task)}>
                <Plus aria-hidden />
                {t('createTask')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
