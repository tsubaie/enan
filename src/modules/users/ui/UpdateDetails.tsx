'use client';
import { useTranslations } from 'next-intl';
import { CircleAlert } from 'lucide-react';
import { useDateTime, useRelativeTime } from '@/ui/format';
import { ShowMore, useShowMore } from '@/ui/layout/ShowMore';
import { Attention, outcomeTitle, Step, type Status } from './update-queries';
import { Code, commands, Panel, StateChip, Version } from './update-parts';

// ADMIN-B57: a failed, rolled back or held update, with what an administrator needs to act on it.
export function Outcome({ status }: { status: Status }) {
  const t = useTranslations('admin');
  const step = Step.safeParse(status.step);
  const rolledBack = status.state === 'rolled_back';
  return (
    <Panel
      title={t(outcomeTitle[Attention.parse(status.state)])}
      tone={status.state === 'blocked' ? 'border-warning/40' : 'border-danger/40'}
    >
      <div className="grid gap-3 text-sm">
        {status.candidate && (
          <p className="text-text-muted">
            {t('updateCandidate')} <Version image={status.candidate} />
          </p>
        )}
        {step.success && status.state !== 'blocked' && (
          <p className="text-text-muted">
            {t('updateFailedAt', { step: t(`updateStep_${step.data}`) })}
          </p>
        )}
        {status.error && (
          <p className="flex items-start gap-2 text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <bdi dir="ltr" className="break-words">
              {status.error}
            </bdi>
          </p>
        )}
        {rolledBack && <p className="font-light text-text-muted">{t('updateRolledBackHelp')}</p>}
        {status.backup && status.restoreCommand && (
          <div className="grid gap-2">
            <p className="font-light text-text-muted">{t('updateRestoreHelp')}</p>
            <Code>{status.restoreCommand}</Code>
          </div>
        )}
        {status.log && (
          <details>
            <summary className="cursor-pointer text-text-muted">{t('updateLog')}</summary>
            <pre
              dir="ltr"
              className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-raised p-3 text-start text-xs whitespace-pre-wrap"
            >
              {status.log}
            </pre>
          </details>
        )}
      </div>
    </Panel>
  );
}

// ADMIN-B69: an updater older than this release needs ignores what it does not know, so the page
// says so and offers what it can still do.
export function UpdaterOutdated() {
  const t = useTranslations('admin');
  return (
    <Panel title={t('updaterOutdated')} tone="border-danger/40">
      <p className="mb-3 text-sm font-light text-text-muted">{t('updaterOutdatedHelp')}</p>
      <Code>{commands.replaceUpdater}</Code>
    </Panel>
  );
}

// ADMIN-B57: the updater's last outcomes, newest first; ADMIN-B70: five at a time (EP-B47).
export function History({ history }: { history: Status[] }) {
  const t = useTranslations('admin');
  // Quiet checks, and an image held back because it failed before: that failure is listed.
  const rows = history.filter(
    (entry) => entry.state !== 'checked' && !(entry.state === 'blocked' && entry.step === 'check'),
  );
  const { visible, peek, props } = useShowMore(rows, 5);
  if (!rows.length) return null;
  return (
    <Panel title={t('updateHistory')}>
      <div className="-mx-5 -mb-5 border-t">
        <ul className="divide-y divide-border/70">
          {visible.map((entry, index) => (
            <HistoryRow key={`${entry.finishedAt ?? ''}-${index}`} entry={entry} />
          ))}
        </ul>
        <ShowMore
          {...props}
          peek={
            peek && (
              <ul className="border-t border-border/70">
                <HistoryRow entry={peek} />
              </ul>
            )
          }
        />
      </div>
    </Panel>
  );
}

function HistoryRow({ entry }: { entry: Status }) {
  const relative = useRelativeTime();
  const dateTime = useDateTime();
  return (
    <li className="flex items-start gap-3 px-5 py-3 text-sm">
      <span className="grid min-w-0 flex-1 gap-1">
        <span>
          <Version image={entry.state === 'updated' ? entry.running : entry.candidate} />
        </span>
        {entry.finishedAt && (
          <time
            dateTime={entry.finishedAt}
            title={dateTime(entry.finishedAt)}
            className="text-xs font-light text-text-muted"
          >
            {relative(entry.finishedAt)}
          </time>
        )}
        {entry.error && (
          <bdi dir="ltr" className="text-xs break-words text-danger">
            {entry.error}
          </bdi>
        )}
      </span>
      <StateChip state={entry.state} />
    </li>
  );
}
