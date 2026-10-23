'use client';
import { useTranslations } from 'next-intl';
import {
  CircleCheck,
  CirclePause,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { type z } from 'zod';
import { useDateTime, useRelativeTime } from '@/ui/format';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { type Health, latestIssue, type Status, useCommand, useUpdates } from './update-queries';
import { Code, commands, Panel, releases, StateChip, Version } from './update-parts';
import { History, Outcome, UpdaterUpdate } from './UpdateDetails';
import { Automatic, Install } from './UpdateInstall';

export function UpdatesPage() {
  const query = useUpdates();
  const command = useCommand();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  const { health, status, history, commands } = query.data.data;
  const issue = latestIssue(status, history);
  const live = health === 'not_running' ? null : status;
  return (
    <div className="space-y-5">
      <UpdaterPanel health={health} status={status} />
      {live && (
        <>
          <Install status={live} command={command} enabled={commands} />
          <Controls status={live} command={command} enabled={commands} />
        </>
      )}
      {command.error && <ErrorPanel error={command.error} />}
      {issue && <Outcome status={issue} />}
      {status?.updaterUpdate && <UpdaterUpdate />}
      {live && (
        // Keyed by the saved setting, so the form shows what the updater recorded once it has.
        <Automatic
          key={`${live.automatic}:${live.window ?? ''}`}
          status={live}
          command={command}
          enabled={commands}
        />
      )}
      {history.length > 0 && <History history={history} />}
    </div>
  );
}

// ADMIN-B57: whether updates happen at all, and if the updater is alive.
function UpdaterPanel({
  health,
  status,
}: {
  health: z.infer<typeof Health>;
  status: Status | null;
}) {
  const t = useTranslations('admin');
  if (health === 'not_running')
    return (
      <Panel title={t('updaterNotRunning')}>
        <p className="mb-3 text-sm leading-relaxed font-light text-text-muted">
          {t('updaterNotRunningHelp')}
        </p>
        <Code>{commands.enable}</Code>
      </Panel>
    );
  if (health === 'unreadable' || !status)
    return (
      <Panel title={t('updaterUnreadable')} tone="border-danger/40">
        <p className="text-sm font-light text-text-muted">{t('updaterUnreadableHelp')}</p>
      </Panel>
    );
  return (
    <Panel title={t('updatesTitle')} tone={health === 'stalled' ? 'border-danger/40' : undefined}>
      {health === 'stalled' && <Stalled />}
      <Facts status={status} />
    </Panel>
  );
}

function Stalled() {
  const t = useTranslations('admin');
  return (
    <div role="alert" className="mb-4 grid gap-2 text-sm text-danger">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        {t('updaterStalled')}
      </p>
      <p className="font-light text-text-muted">{t('updaterStalledHelp')}</p>
      <Code>{commands.logs}</Code>
    </div>
  );
}

function Facts({ status }: { status: Status }) {
  const t = useTranslations('admin');
  const relative = useRelativeTime();
  const dateTime = useDateTime();
  const minutes = Math.max(1, Math.round(status.intervalSeconds / 60));
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-text-muted">{t('updateRunning')}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <Version image={status.running} />
        {status.running?.version && (
          <a
            href={`${releases}${status.running.version}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent underline-offset-4 hover:underline"
          >
            {t('updateReleaseNotes')}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </dd>
      <dt className="text-text-muted">{t('updateChannel')}</dt>
      <dd>
        <bdi dir="ltr">{status.channel || t('updateVersionUnknown')}</bdi>
      </dd>
      <dt className="text-text-muted">{t('updateLastCheck')}</dt>
      <dd>
        {status.lastCheckAt ? (
          <time dateTime={status.lastCheckAt} title={dateTime(status.lastCheckAt)}>
            {relative(status.lastCheckAt)}
          </time>
        ) : (
          t('updateNever')
        )}
        <span className="text-text-muted"> · {t('updateEvery', { minutes })}</span>
      </dd>
      <dt className="text-text-muted">{t('updateLastResult')}</dt>
      <dd className="flex items-center gap-2">
        <StateChip state={status.paused ? 'paused' : status.state} />
      </dd>
    </dl>
  );
}

// Try again clears the updater's list of images that failed; it does nothing for an update held
// back as a contract migration (step `guard`), which waits for the operator.
const retryable = (status: Status) =>
  status.state === 'rolled_back' || (status.state === 'blocked' && status.step === 'check');
// ADMIN-B58: what an administrator can ask of the updater from here.
function Controls({
  status,
  command,
  enabled,
}: {
  status: Status;
  command: ReturnType<typeof useCommand>;
  enabled: boolean;
}) {
  const t = useTranslations('admin');
  const busy = command.isPending || !enabled;
  const sent = command.isSuccess && command.data.data.command;
  const send = (name: 'check' | 'pause' | 'resume' | 'retry') => () =>
    command.mutate({ command: name });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || status.paused} onClick={send('check')}>
          <RefreshCw className="size-4" aria-hidden />
          {t('updateCheckNow')}
        </Button>
        {status.paused ? (
          <Button variant="secondary" disabled={busy} onClick={send('resume')}>
            <CircleCheck className="size-4" aria-hidden />
            {t('updateResume')}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={send('pause')}>
            <CirclePause className="size-4" aria-hidden />
            {t('updatePause')}
          </Button>
        )}
        {retryable(status) && (
          <Button variant="secondary" disabled={busy} onClick={send('retry')}>
            <RotateCcw className="size-4" aria-hidden />
            {t('updateRetry')}
          </Button>
        )}
      </div>
      {!enabled && <p className="text-sm text-danger">{t('updateCommandsUnavailable')}</p>}
      {sent && (
        <p role="status" className="text-sm text-text-muted">
          {t('updateCommandSent', { command: t(`updateCommand_${sent}`) })}
        </p>
      )}
    </div>
  );
}
