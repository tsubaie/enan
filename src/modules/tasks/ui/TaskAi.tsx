'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePlainDate } from '@/ui/format';
import { cn } from '@/ui/cn';
import { AiPanel } from '@/ui/ai/AiPanel';
import { useAiReview, type AiReview } from '@/ui/ai/queries';
import { Button } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';
import { z } from 'zod';
import { type TaskDetail } from '../schema/validation';
import { BreakdownOutput } from '../schema/validation';
export function TaskAi({ task }: { task: TaskDetail }) {
  const t = useTranslations('ai');
  const review = useAiReview(
    'tasks.breakdown',
    task.id,
    task.revision,
    `/tasks/${task.id}/breakdown`,
  );
  const output = BreakdownOutput.safeParse(review.job?.result?.output);
  if (task.deletedAt || task.parentId || task.status === 'completed' || task.subtasks.length)
    return null;
  return (
    <AiPanel review={review} title={t('breakdown')}>
      {output.success && (
        <TaskSuggestions key={review.job?.id} review={review} output={output.data} />
      )}
    </AiPanel>
  );
}

function TaskSuggestions({
  review,
  output,
}: {
  review: AiReview;
  output: z.infer<typeof BreakdownOutput>;
}) {
  const t = useTranslations('ai');
  const [indexes, setIndexes] = useState<number[]>([]);
  return (
    <div className="space-y-3">
      {/* A suggestion is greyed until it is ticked; ticking it brings it to full ink, so the eye sees
          at a glance which ones will be added. Descriptions are Light so the titles lead. */}
      {output.subtasks.map((task, index) => (
        <Suggestion
          key={task.title}
          task={task}
          picked={indexes.includes(index)}
          locked={review.stale}
          onPick={(checked) =>
            setIndexes(checked ? [...indexes, index] : indexes.filter((value) => value !== index))
          }
        />
      ))}
      {/* Once the task has changed the suggestions can no longer be applied (TASKS-B13), so the
          action offered is a new draft rather than an Apply that can never be pressed. */}
      <div className="flex flex-wrap gap-2 pt-1">
        {review.stale ? (
          <Button onClick={() => review.start.mutate()}>{t('regenerate')}</Button>
        ) : (
          <Button
            disabled={!indexes.length || review.apply.isPending}
            onClick={() => review.apply.mutate({ jobId: review.job?.id ?? '', indexes })}
          >
            {t('applySelected')}
          </Button>
        )}
      </div>
    </div>
  );
}
// One suggestion: greyed until ticked, full ink once it will be added; its description Light.
function Suggestion({
  task,
  picked,
  locked,
  onPick,
}: {
  task: z.infer<typeof BreakdownOutput>['subtasks'][number];
  picked: boolean;
  locked: boolean;
  onPick: (checked: boolean) => void;
}) {
  const date = usePlainDate();
  return (
    <label
      className={cn(
        'flex items-start gap-3 text-sm transition-colors duration-150',
        picked ? 'text-text' : 'text-text-faint',
      )}
    >
      <Checkbox checked={picked} disabled={locked} onCheckedChange={onPick} />
      <span dir="auto">
        <span className="font-medium">{task.title}</span>
        {task.description && (
          <span className={cn('mt-1 block font-light', picked && 'text-text-muted')}>
            {task.description}
          </span>
        )}
        {task.dueDate && (
          <span className={cn('mt-1 block font-light', picked && 'text-text-muted')}>
            <bdi>{date(task.dueDate)}</bdi>
          </span>
        )}
      </span>
    </label>
  );
}
