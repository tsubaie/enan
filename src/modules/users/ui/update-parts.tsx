'use client';
import { useId, type ReactNode } from 'react';
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
};
export const releases = defaults.releaseNotes;
// Commands an operator runs on the server; shown as they are, in every language.
export const commands = {
  enable: 'docker compose --profile autoupdate up -d',
  logs: 'docker compose logs updater',
  replaceUpdater:
    'docker compose --profile autoupdate pull updater\ndocker compose --profile autoupdate up -d updater',
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
