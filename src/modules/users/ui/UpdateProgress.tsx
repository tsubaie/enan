'use client';
import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check, CircleCheck, LoaderCircle, RotateCw } from 'lucide-react';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { type Status, stepAt, steps, useElapsed } from './update-queries';
import { Panel, Version } from './update-parts';

type Step = (typeof steps)[number];

// ADMIN-B67: from the press until the updater reports the install started, the button says so.
export function Pressed({ starting, children }: { starting: boolean; children: ReactNode }) {
  const t = useTranslations('admin');
  if (!starting) return children;
  return (
    <>
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {t('updateInstallStarting')}
    </>
  );
}

// ADMIN-B67: a release the running one cannot go back from is installed only once confirmed.
export function ConfirmInstall({
  open,
  onOpenChange,
  pending,
  starting,
  onInstall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  starting: boolean;
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
          <Button disabled={pending || starting} aria-busy={starting} onClick={onInstall}>
            <Pressed starting={starting}>{t('updateConfirmInstall')}</Pressed>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ADMIN-B67: where an install stands; done and rolled back are the outcomes the page shows after.
export function Progress({ status, reconnecting }: { status: Status; reconnecting: boolean }) {
  const t = useTranslations('admin');
  const at = stepAt(status.step);
  const elapsed = useElapsed(status.startedAt);
  return (
    <Panel title={t('updateInstalling')} tone="border-accent/35">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-text-muted">
        {at >= 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
            {t('updateStepProgress', { current: at + 1, total: steps.length })}
          </span>
        )}
        {status.candidate && (
          <span dir="ltr" className="inline-flex items-center gap-1.5">
            <Version image={status.running} />
            <ArrowRight className="size-3" aria-hidden />
            <Version image={status.candidate} />
          </span>
        )}
        {elapsed && (
          <span className="ms-auto tabular-nums">{t('updateElapsed', { time: elapsed })}</span>
        )}
      </div>
      <div className="mb-5 grid grid-cols-4 gap-1.5" aria-hidden>
        {steps.map((step, index) => (
          <span
            key={step}
            className={cn(
              'h-1.5 rounded-full',
              index <= at ? 'bg-accent' : 'bg-surface-raised',
              index === at && 'animate-pulse motion-reduce:animate-none',
            )}
          />
        ))}
      </div>
      <ol role="status" className="grid gap-4 text-sm">
        {steps.map((step, index) => (
          <Stage
            key={step}
            step={step}
            index={index}
            at={at}
            backup={status.backup}
            reconnecting={reconnecting}
          />
        ))}
      </ol>
    </Panel>
  );
}

const ink = { done: 'text-text-muted', active: 'font-medium text-text', next: 'text-text-faint' };
const badge = {
  done: 'border-accent/40 bg-accent text-on-accent',
  active: 'border-accent/40 bg-accent-soft text-accent',
  next: 'border-border text-text-faint',
};

const stageOf = (index: number, at: number) =>
  index < at ? 'done' : index === at ? 'active' : 'next';

function Stage({
  step,
  index,
  at,
  backup,
  reconnecting,
}: {
  step: Step;
  index: number;
  at: number;
  backup: string | undefined;
  reconnecting: boolean;
}) {
  const t = useTranslations('admin');
  const stage = stageOf(index, at);
  // The new container takes a few seconds to answer; the page says so rather than look stuck.
  const pause = stage === 'active' && (step === 'switch' || step === 'verify' || reconnecting);
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums',
          badge[stage],
        )}
      >
        {stage === 'done' && <Check className="size-3.5" />}
        {stage === 'active' && (
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
        )}
        {stage === 'next' && index + 1}
      </span>
      <div className="grid gap-1">
        <span aria-current={stage === 'active' ? 'step' : undefined} className={ink[stage]}>
          {t(`updateProgress_${step}`)}
        </span>
        <span className="text-xs font-light text-text-muted">
          {t(`updateProgressDetail_${step}`)}
        </span>
        {step === 'backup' && backup && (
          <code dir="ltr" className="w-fit rounded bg-surface-raised px-1.5 py-0.5 text-xs">
            {backup}
          </code>
        )}
        {pause && (
          <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
            {t('updateReconnectingNotice')}
          </p>
        )}
      </div>
    </li>
  );
}

// ADMIN-B67: an install this page watched has finished; the page itself is still the old release.
export function Completed({ status }: { status: Status }) {
  const t = useTranslations('admin');
  return (
    <Panel title={t('updateCompletedTitle')} tone="border-accent/40">
      <div role="status" className="grid gap-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <CircleCheck className="size-4 text-accent" aria-hidden />
          {t('updateCompletedRunning')} <Version image={status.running} />
        </p>
        {status.backup && (
          <p className="flex flex-wrap items-center gap-2 text-text-muted">
            {t('updateCompletedBackup')}
            <code dir="ltr" className="rounded bg-surface-raised px-1.5 py-0.5 text-xs">
              {status.backup}
            </code>
          </p>
        )}
        <div>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <RotateCw className="size-4" aria-hidden />
            {t('updateReloadPage')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
