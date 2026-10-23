'use client';
import { type ReactNode, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleCheck, ExternalLink, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { type z } from 'zod';
import { useDateTime, useRelativeTime } from '@/ui/format';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import {
  type Answer,
  type Health,
  latestIssue,
  type Status,
  useCommand,
  useUpdates,
} from './update-queries';
import {
  type Asked,
  Code,
  commands,
  Followup,
  Panel,
  releases,
  StateChip,
  Version,
} from './update-parts';
import { History, Outcome, UpdaterOutdated } from './UpdateDetails';
import { UpdaterUpdate } from './UpdaterUpdate';
import { Automatic, Install } from './UpdateInstall';

export function UpdatesPage() {
  const query = useUpdates();
  const command = useCommand();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  return <Updates answer={query.data.data} command={command} />;
}

// What the updater said, and what can be asked of it.
function Updates({
  answer,
  command,
}: {
  answer: Answer['data'];
  command: ReturnType<typeof useCommand>;
}) {
  const { health, status, history, commands, outdated } = answer;
  const issue = latestIssue(status, history);
  const live = health === 'not_running' ? null : status;
  // ADMIN-B69: an older updater neither announces nor installs on request, so neither is offered.
  const askable = outdated ? null : live;
  return (
    <div className="space-y-5">
      <UpdaterPanel health={health} status={status}>
        {live && <Controls status={live} command={command} enabled={commands} />}
      </UpdaterPanel>
      {outdated ? (
        <UpdaterOutdated />
      ) : (
        live && <UpdaterUpdate status={live} command={command} enabled={commands} />
      )}
      {askable && <Install status={askable} command={command} enabled={commands} />}
      {command.error && <ErrorPanel error={command.error} />}
      {issue && <Outcome status={issue} />}
      {askable && (
        // Keyed by the saved setting, so the form shows what the updater recorded once it has.
        <Automatic
          key={`${askable.automatic}:${askable.window ?? ''}`}
          status={askable}
          command={command}
          enabled={commands}
        />
      )}
      <History history={history} />
    </div>
  );
}

// ADMIN-B57: whether updates happen at all, and if the updater is alive. ADMIN-B58: what can be
// asked of it sits in the same card, under the facts it changes.
function UpdaterPanel({
  health,
  status,
  children,
}: {
  health: z.infer<typeof Health>;
  status: Status | null;
  children: ReactNode;
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
      <div className="mt-5 border-t border-border/70 pt-4">{children}</div>
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
  const every = intervalOf(status.intervalSeconds);
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
        <span className="text-text-muted"> · {t('updateEvery', every)}</span>
      </dd>
      <dt className="text-text-muted">{t('updateLastResult')}</dt>
      <dd className="flex items-center gap-2">
        <StateChip state={status.paused ? 'paused' : status.state} />
      </dd>
    </dl>
  );
}

// How often the updater checks, in the largest whole unit: a day reads "daily", not 1440 minutes.
function intervalOf(seconds: number) {
  if (seconds >= 86400 && seconds % 86400 === 0) return { unit: 'day', count: seconds / 86400 };
  if (seconds >= 3600 && seconds % 3600 === 0) return { unit: 'hour', count: seconds / 3600 };
  return { unit: 'minute', count: Math.max(1, Math.round(seconds / 60)) };
}
// Try again clears the updater's list of images that failed; it does nothing for an update held
// back as a contract migration (step `guard`), which waits for the operator.
const retryable = (status: Status) =>
  status.state === 'rolled_back' || (status.state === 'blocked' && status.step === 'check');
// ADMIN-B58: what an administrator can ask of the updater from here. Pausing is left to the server:
// with installs on demand nothing needs stopping, and a paused updater is offered Resume.
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
  const [asked, setAsked] = useState<Asked | null>(null);
  const sent = command.isSuccess && command.data.data.command;
  // Install now and the setting answer in their own panels; these four answer here.
  const send = (name: Asked['name']) => () => {
    const { lastCheckAt, startedAt, finishedAt } = status;
    setAsked({ id: Date.now(), name, from: { lastCheckAt, startedAt, finishedAt } });
    command.mutate({ command: name });
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || status.paused} onClick={send('check')}>
          <RefreshCw className="size-4" aria-hidden />
          {t('updateCheckNow')}
        </Button>
        {status.paused && (
          <Button variant="secondary" disabled={busy} onClick={send('resume')}>
            <CircleCheck className="size-4" aria-hidden />
            {t('updateResume')}
          </Button>
        )}
        {retryable(status) && (
          <Button variant="secondary" disabled={busy} onClick={send('retry')}>
            <RotateCcw className="size-4" aria-hidden />
            {t('updateRetry')}
          </Button>
        )}
        {/* The answer sits beside the button that asked; it wraps under it on a narrow screen. */}
        {asked && sent === asked.name ? (
          <Followup key={asked.id} asked={asked} status={status} />
        ) : (
          sent && (
            <p role="status" className="text-sm text-text-muted">
              {t('updateCommandSent', { command: t(`updateCommand_${sent}`) })}
            </p>
          )
        )}
      </div>
      {status.paused && <p className="text-sm text-text-muted">{t('updatePausedWhy')}</p>}
      {!enabled && <p className="text-sm text-danger">{t('updateCommandsUnavailable')}</p>}
    </div>
  );
}
