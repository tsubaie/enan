'use client';
import { useTranslations } from 'next-intl';
import { cn } from '@/ui/cn';
import { type AuditChange, changeOf } from '@/core/config/audit-schema';
import { useAuditChanges, type Json } from './audit-changes';
// ADMIN-B71: what a change did to the record, as a diff would mark it: added, removed or changed,
// by the same words the Done filter uses (ADMIN-B73). Anything else (a download, an AI run) marks
// nothing; a failed sign-in is marked as one.
export type Mark = AuditChange | 'failed' | null;
export function markOf(action: string): Mark {
  return action === 'sign_in_failed' ? 'failed' : changeOf(action);
}
// The row's leading edge in the mark's colour; a row that marks nothing keeps the edge's width.
export const edge: Record<NonNullable<Mark> | 'none', string> = {
  added: 'border-s-success',
  removed: 'border-s-danger',
  changed: 'border-s-warning',
  failed: 'border-s-danger',
  none: 'border-s-transparent',
};
// ADMIN-B71: the change itself, as a diff reads: what a field was on a red line marked −, what it
// is now on a green one marked +, and a removal's values in red. The marks are words to a screen
// reader, so colour is never the only sign.
export function AuditChanges({
  row,
  removed,
}: {
  row: { action: string; entityType: string; diff?: Json | undefined };
  removed: boolean;
}) {
  const t = useTranslations('admin');
  const describe = useAuditChanges();
  const changes = describe(row.entityType, row.diff, markOf(row.action) === 'added');
  if (!changes.length) return null;
  return (
    <ul className="mt-1 grid overflow-hidden rounded-lg border border-border/70 text-xs">
      {changes.flatMap((change) => [
        ...(change.before === undefined
          ? []
          : [
              <DiffLine
                key={`${change.label}-was`}
                sign="−"
                label={change.label}
                value={change.before}
                was
                word={t('auditWas')}
              />,
            ]),
        <DiffLine
          key={change.label}
          sign={removed ? '−' : '+'}
          label={change.label}
          value={change.value}
          was={removed}
          word={t(removed ? 'auditWas' : 'auditNow')}
        />,
      ])}
    </ul>
  );
}
function DiffLine({
  sign,
  label,
  value,
  was,
  word,
}: {
  sign: string;
  label: string;
  value: string;
  was: boolean;
  word: string;
}) {
  return (
    <li className={cn('flex gap-2 px-2.5 py-1', was ? 'bg-danger-soft' : 'bg-success-soft')}>
      <span
        aria-hidden
        className={cn('w-2 shrink-0 font-medium', was ? 'text-danger' : 'text-success')}
      >
        {sign}
      </span>
      <span className="sr-only">{word}</span>
      <span className="min-w-0">
        <span className="font-medium">{label}:</span> <bdi dir="auto">{value}</bdi>
      </span>
    </li>
  );
}
