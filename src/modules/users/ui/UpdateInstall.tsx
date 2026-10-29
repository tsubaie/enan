'use client';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { type Status, type useCommand, useFinished } from './update-queries';
import { Candidate, Panel } from './update-parts';
import { Completed, ConfirmInstall, Pressed, Progress } from './UpdateProgress';

type Send = ReturnType<typeof useCommand>;

// ADMIN-B67: an install under way, or one just finished. What waits for Install now is announced
// in the Updates card (`Available`).
export function Install({ status, reconnecting }: { status: Status; reconnecting: boolean }) {
  const finished = useFinished(status.state);
  if (status.state === 'updating') return <Progress status={status} reconnecting={reconnecting} />;
  return finished ? <Completed status={status} /> : null;
}

const help = (status: Status, release: boolean) => {
  if (!release) return 'updateAvailableSmall';
  return status.confirm ? 'updateAvailableContract' : 'updateAvailableHelp';
};

// ADMIN-B67: a release the updater announced, installed only when an administrator chooses. It
// sits inside the Updates card, under the check that found it, rather than as a card of its own.
// ADMIN-B75: one announcement and one Install now for whatever is newer, Enan or its updater; the
// reader need not tell them apart.
export function Available({
  status,
  command,
  enabled,
}: {
  status: Status | null;
  command: Send;
  enabled: boolean;
}) {
  const t = useTranslations('admin');
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  // What Install now was pressed for: it stays pressed until the updater starts, or the request fails.
  const [queued, setQueued] = useState<string | null>(null);
  if (!status) return null;
  // Only the updater newer: no release of Enan to name, and nothing of Enan's to back up.
  const candidate = status.state === 'available' ? status.candidate : undefined;
  const digest = candidate?.digest;
  // ADMIN-B75: an updater this old announces nothing (ADMIN-B69, ADMIN-B74).
  const target = digest ?? (status.protocol >= 3 ? status.updaterUpdate : undefined);
  if (!target) return null;
  const starting = queued === target && !command.isError;
  const install = (confirm: boolean) => {
    setQueued(target);
    command.mutate(
      digest ? { command: 'install', digest, confirm } : { command: 'install', confirm },
      { onSuccess: () => setConfirming(false) },
    );
  };
  return (
    <section aria-labelledby={id} className="mt-5 border-t border-border/70 pt-4">
      <h3 id={id} className="mb-3 font-medium text-success">
        {t('updateAvailableTitle')}
      </h3>
      <div className="grid gap-3 text-sm">
        {candidate && <Candidate candidate={candidate} />}
        <p className="font-light text-text-muted">{t(help(status, Boolean(candidate)))}</p>
        <div>
          <Button
            disabled={starting || command.isPending || !enabled || status.paused}
            aria-busy={starting}
            onClick={() => (status.confirm ? setConfirming(true) : install(false))}
          >
            <Pressed starting={starting}>
              <Download className="size-4" aria-hidden />
              {t('updateInstallNow')}
            </Pressed>
          </Button>
        </div>
      </div>
      <ConfirmInstall
        open={confirming}
        onOpenChange={setConfirming}
        pending={command.isPending}
        starting={starting}
        onInstall={() => install(true)}
      />
    </section>
  );
}

const span = (window: string | undefined) => {
  const [from = '', to = ''] = (window ?? '').split('-');
  return { from, to };
};

// ADMIN-B68: whether releases install without Install now, and inside which daily window.
export function Automatic({
  status,
  command,
  enabled,
}: {
  status: Status;
  command: Send;
  enabled: boolean;
}) {
  const t = useTranslations('admin');
  const [automatic, setAutomatic] = useState(status.automatic);
  const [from, setFrom] = useState(span(status.window).from);
  const [to, setTo] = useState(span(status.window).to);
  // Both ends or neither: half a window is no window.
  const window = from && to ? `${from}-${to}` : '';
  // A window is kept while automatic installing is off, but only checked while it is on.
  const partial = automatic && (Boolean(from) !== Boolean(to) || (from !== '' && from === to));
  return (
    <Panel title={t('updateAutomaticTitle')}>
      <form
        className="grid gap-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          command.mutate({ command: 'settings', automatic, window });
        }}
      >
        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={automatic}
            onCheckedChange={(checked) => setAutomatic(Boolean(checked))}
          />
          <span className="grid gap-1">
            <span className="font-medium">{t('updateAutomatic')}</span>
            <span className="font-light text-text-muted">{t('updateAutomaticHelp')}</span>
          </span>
        </label>
        {automatic && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 font-medium">
              {t('updateWindow', { zone: status.timeZone ?? 'UTC' })}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Time label={t('updateWindowFrom')} value={from} onChange={setFrom} />
              <Time label={t('updateWindowTo')} value={to} onChange={setTo} />
            </div>
            <p className="font-light text-text-muted">{t('updateWindowHelp')}</p>
          </fieldset>
        )}
        <div>
          <Button type="submit" disabled={command.isPending || !enabled || partial}>
            {t('updateAutomaticSave')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Time({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <Input {...control} type="time" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}
