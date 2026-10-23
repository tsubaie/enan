'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, ExternalLink } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Checkbox } from '@/ui/primitives/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { type Status, type useCommand } from './update-queries';
import { Panel, releases, Version } from './update-parts';

type Send = ReturnType<typeof useCommand>;

// ADMIN-B67: an install under way, or a release waiting for Install now.
export function Install({
  status,
  command,
  enabled,
}: {
  status: Status;
  command: Send;
  enabled: boolean;
}) {
  if (status.state === 'updating') return <Progress status={status} />;
  if (status.state === 'available')
    return <Available status={status} command={command} enabled={enabled} />;
  return null;
}

// ADMIN-B67: a release the updater announced, installed only when an administrator chooses.
function Available({
  status,
  command,
  enabled,
}: {
  status: Status;
  command: Send;
  enabled: boolean;
}) {
  const t = useTranslations('admin');
  const [confirming, setConfirming] = useState(false);
  const candidate = status.candidate;
  if (!candidate?.digest) return null;
  const digest = candidate.digest;
  const install = (confirm: boolean) =>
    command.mutate(
      { command: 'install', digest, confirm },
      { onSuccess: () => setConfirming(false) },
    );
  return (
    <Panel title={t('updateAvailableTitle')} tone="border-accent/40">
      <div className="grid gap-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          {t('updateCandidate')} <Version image={candidate} />
          {candidate.version && (
            <a
              href={`${releases}${candidate.version}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent underline-offset-4 hover:underline"
            >
              {t('updateReleaseNotes')}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </p>
        <p className="font-light text-text-muted">
          {t(status.confirm ? 'updateAvailableContract' : 'updateAvailableHelp')}
        </p>
        <div>
          <Button
            disabled={command.isPending || !enabled || status.paused}
            onClick={() => (status.confirm ? setConfirming(true) : install(false))}
          >
            <Download className="size-4" aria-hidden />
            {t('updateInstallNow')}
          </Button>
        </div>
      </div>
      <ConfirmInstall
        open={confirming}
        onOpenChange={setConfirming}
        pending={command.isPending}
        onInstall={() => install(true)}
      />
    </Panel>
  );
}

// ADMIN-B67: a release the running one cannot go back from is installed only once confirmed.
function ConfirmInstall({
  open,
  onOpenChange,
  pending,
  onInstall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onInstall: () => void;
}) {
  const t = useTranslations('admin');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t('updateConfirmTitle')}</DialogTitle>
        <DialogDescription>{t('updateConfirmBody')}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('updateConfirmCancel')}
          </Button>
          <Button disabled={pending} onClick={onInstall}>
            {t('updateConfirmInstall')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const steps: ('backup' | 'switch' | 'verify')[] = ['backup', 'switch', 'verify'];

// ADMIN-B67: where an install stands; done and rolled back are the outcomes the page shows after.
function Progress({ status }: { status: Status }) {
  const t = useTranslations('admin');
  const at = steps.findIndex((step) => step === status.step);
  return (
    <Panel title={t('updateInstalling')}>
      <p className="mb-3 text-sm text-text-muted">
        {t('updateCandidate')} <Version image={status.candidate} />
      </p>
      <ol role="status" className="grid gap-1 text-sm">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === at ? 'step' : undefined}
            className={index === at ? 'font-medium text-accent' : 'text-text-muted'}
          >
            {t(`updateProgress_${step}`)}
          </li>
        ))}
      </ol>
    </Panel>
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
  const partial = Boolean(from) !== Boolean(to) || (from !== '' && from === to);
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
        <fieldset className="grid gap-2" disabled={!automatic}>
          <legend className="mb-2 font-medium">
            {t('updateWindow', { zone: status.timeZone ?? 'UTC' })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Time label={t('updateWindowFrom')} value={from} onChange={setFrom} />
            <Time label={t('updateWindowTo')} value={to} onChange={setTo} />
          </div>
          <p className="font-light text-text-muted">{t('updateWindowHelp')}</p>
        </fieldset>
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
