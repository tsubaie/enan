'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { useRelativeTime } from '@/ui/format';
import type { CaptureGroup, Suggestion } from '../schema/validation';
import { failure } from './CaptureProcessing';
import { useCaptures, useRemoveCapture, useRetryCapture } from './capture-queries';
// The recordings waiting on the reader, newest first: each one's processing state, what failed
// and the drafts it produced. Reviewing and approving drafts is the inbox's (CAPTURES-B08–B11).
export function CapturesPage() {
  const t = useTranslations('captures');
  const query = useCaptures();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} />;
  const groups = query.data.data;
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4 lg:p-6">
      <h1 className="font-display text-2xl">{t('review')}</h1>
      <p className="text-sm text-text-muted">{t('education')}</p>
      {groups.length === 0 ? (
        <div className="grid gap-1 rounded-xl border p-6 text-center">
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="text-sm text-text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {groups.map((group) => (
            <Group key={group.id} group={group} />
          ))}
        </ul>
      )}
    </div>
  );
}
function Group({ group }: { group: CaptureGroup }) {
  const t = useTranslations('captures');
  const format = useFormatter();
  const relative = useRelativeTime();
  const pending = group.suggestions.filter((suggestion) => suggestion.status === 'pending');
  const working = ['queued', 'transcribing', 'interpreting'].includes(group.status);
  return (
    <li className="grid gap-2 rounded-xl border p-4 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {t('groupTitle', {
            time: format.dateTime(new Date(group.createdAt), {
              hour: 'numeric',
              minute: '2-digit',
            }),
          })}
        </span>
        <span aria-hidden className="h-3.5 w-px bg-border" />
        <span>{t('draftCount', { count: pending.length })}</span>
        <time dateTime={group.createdAt} className="ms-auto text-text-muted">
          {relative(group.createdAt)}
        </time>
      </p>
      {working && (
        <p className="flex items-center gap-2 text-text-muted">
          <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
          {group.status === 'interpreting' ? t('preparingDrafts') : t('transcribing')}
        </p>
      )}
      {group.status === 'needs_transcript' && <p>{t('unavailable')}</p>}
      {group.status === 'failed' && <p>{t(failure(group.errorCode))}</p>}
      <Drafts drafts={pending} />
      {(group.status === 'failed' || group.status === 'needs_transcript') && (
        <Recover group={group} />
      )}
    </li>
  );
}
const titleOf = (payload: Suggestion['payload']) =>
  payload && typeof payload === 'object' && 'title' in payload ? String(payload.title) : '';
function Drafts({ drafts }: { drafts: Suggestion[] }) {
  const t = useTranslations('captures');
  if (!drafts.length) return null;
  return (
    <ul className="grid gap-1">
      {drafts.map((suggestion) => (
        <li key={suggestion.id} className="flex items-center gap-2">
          <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs">
            {t(`kind_${suggestion.kind}`)}
          </span>
          <span dir="auto">{titleOf(suggestion.payload)}</span>
        </li>
      ))}
    </ul>
  );
}
// S17: retry, or delete the recording. Typing a transcript in place arrives with the inbox.
function Recover({ group }: { group: CaptureGroup }) {
  const t = useTranslations('captures');
  const retry = useRetryCapture();
  const remove = useRemoveCapture();
  const error = retry.error ?? remove.error;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate(group)}>
          {t('retry')}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate(group.id)}
        >
          {t('deleteRecording')}
        </Button>
      </div>
      {error && <ErrorPanel error={error} />}
    </>
  );
}
