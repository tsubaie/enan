'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/ui/cn';
import { defaults } from '@/core/config/defaults';
import { State, type Status } from './update-queries';

const tone: Record<State, string> = {
  checking: 'bg-surface-raised text-text-muted',
  checked: 'bg-surface-raised text-success',
  updating: 'bg-accent-soft text-accent',
  updated: 'bg-surface-raised text-success',
  failed: 'bg-danger-soft text-danger',
  rolled_back: 'bg-warning-soft text-warning',
  rollback_failed: 'bg-danger-soft text-danger',
  blocked: 'bg-warning-soft text-warning',
  paused: 'bg-surface-raised text-text-muted',
  available: 'bg-accent-soft text-accent',
};
export const releases = defaults.releaseNotes;
// Commands an operator runs on the server; shown as they are, in every language.
export const commands = {
  enable: 'docker compose up -d updater',
  logs: 'docker compose logs updater',
  replaceUpdater: 'docker compose pull updater\ndocker compose up -d updater',
};

export function Panel({
  title,
  children,
  tone,
}: {
  title: string;
  children: ReactNode;
  tone?: string | undefined;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('rounded-xl border bg-bg/50 p-5', tone)}>
      <h2 id={id} className="mb-3 font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Wrapped, not scrolled: a command is copied whole, so all of it must be in view.
export function Code({ children }: { children: string }) {
  return (
    <code
      dir="ltr"
      className="block rounded-lg bg-surface-raised px-3 py-2 text-start text-xs break-all whitespace-pre-wrap"
    >
      {children}
    </code>
  );
}

export function StateChip({ state }: { state: string }) {
  const t = useTranslations('admin');
  const known = State.safeParse(state);
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
        known.success ? tone[known.data] : 'bg-surface-raised text-text-muted',
      )}
    >
      {known.success ? t(`updateState_${known.data}`) : state}
    </span>
  );
}

export function Version({ image }: { image: Status['running'] }) {
  const t = useTranslations('admin');
  if (!image?.version && !image?.revision) return <>{t('updateVersionUnknown')}</>;
  return (
    <bdi dir="ltr">
      {image.version ?? ''}
      {image.revision && (
        <span className="ms-1.5 text-text-muted">({image.revision.slice(0, 7)})</span>
      )}
    </bdi>
  );
}

// ADMIN-B58: what the page is waiting for after Check now, Pause, Resume or Try again, and the
// status it was asked from, so it can tell when the updater has answered.
export type Asked = {
  id: number;
  name: 'check' | 'pause' | 'resume' | 'retry';
  lastCheckAt: string | undefined;
};
const results: Partial<
  Record<string, 'updateResult_checked' | 'updateResult_available' | 'updateResult_updating'>
> = {
  checked: 'updateResult_checked',
  available: 'updateResult_available',
  updating: 'updateResult_updating',
};

// The answer to a request, once the updater's status shows it: a pause is answered when the status
// says paused, anything else when a check newer than the one the page was showing has finished.
export function Followup({ asked, status }: { asked: Asked; status: Status }) {
  const t = useTranslations('admin');
  const [slow, setSlow] = useState(false);
  // sync: a request the updater has not answered in a minute says so instead of waiting silently.
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 60_000);
    return () => clearTimeout(timer);
  }, []);
  const done =
    asked.name === 'pause'
      ? status.paused
      : status.lastCheckAt !== asked.lastCheckAt && status.state !== 'checking';
  let text: string;
  if (!done) text = slow ? t('updateNoAnswer') : t(`updateWaiting_${asked.name}`);
  else if (asked.name === 'pause') text = t('updatePausedNow');
  else text = t(results[status.state] ?? 'updateResult_problem');
  return (
    <p role="status" aria-busy={!done} className="text-sm text-text-muted">
      {text}
    </p>
  );
}
