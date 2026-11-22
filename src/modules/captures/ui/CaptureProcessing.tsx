'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, CircleCheck, CircleDashed, LoaderCircle, WifiOff } from 'lucide-react';
import { routes } from '@/core/routes';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { clock } from '@/modules/notes/ui';
import type { CaptureGroup } from '../schema/validation';
import type { Placement } from './CaptureRecorder';
// What the panel says after Stop, from the upload and the capture's own status (S11, S12, S29).
export type Stage = 'uploading' | 'offline' | 'working' | 'ready' | 'unavailable' | 'failed';
export function stageOf(
  uploading: boolean,
  offline: boolean,
  capture: CaptureGroup | undefined,
): Stage {
  if (offline) return 'offline';
  if (uploading || !capture) return 'uploading';
  if (capture.status === 'ready') return 'ready';
  if (capture.status === 'needs_transcript') return 'unavailable';
  if (capture.status === 'failed') return 'failed';
  return 'working';
}
type Step = 'done' | 'active' | 'waiting';
function Line({ step, children }: { step: Step; children: React.ReactNode }) {
  const Icon = step === 'done' ? Check : step === 'active' ? LoaderCircle : CircleDashed;
  return (
    <li className={cn('flex items-center gap-2', step === 'waiting' && 'text-text-muted')}>
      <Icon
        aria-hidden
        className={cn(
          'size-4',
          step === 'active' && 'motion-safe:animate-spin',
          step === 'done' && 'text-success',
        )}
      />
      {children}
    </li>
  );
}
export const failure = (code: string | null) =>
  code === 'no_speech' ? 'failedNoSpeech' : code === 'timeout' ? 'failedTimeout' : 'failedOther';
type Props = {
  placement: Placement;
  stage: Stage;
  capture: CaptureGroup | undefined;
  seconds: number;
  done: () => void;
  retry: () => void;
};
// S11: the recorder may leave as soon as the audio is accepted. Done dismisses; Review opens the
// inbox, which may still be processing; same-session readiness offers Review now or Later.
export function CaptureProcessing(props: Props) {
  const t = useTranslations('captures');
  return (
    <section
      role="status"
      aria-label={t('processingLabel')}
      className={cn(
        'fixed z-40 grid gap-3 rounded-2xl border bg-popover p-4 text-sm shadow-lg',
        props.placement === 'mobile-fullscreen'
          ? 'inset-x-3 bottom-[calc(var(--mobile-nav-clear)+0.5rem)]'
          : 'end-4 bottom-4 w-[380px]',
      )}
    >
      {props.stage === 'offline' ? (
        <Offline {...props} />
      ) : props.stage === 'ready' ? (
        <Ready {...props} />
      ) : (
        <Saved {...props} />
      )}
    </section>
  );
}
function ReviewLink({
  label,
  primary,
  done,
}: {
  label: string;
  primary: boolean;
  done: () => void;
}) {
  return (
    <Link
      href={routes.captures()}
      onClick={done}
      className={buttonVariants({ variant: primary ? 'default' : 'outline' })}
    >
      {label}
    </Link>
  );
}
// S12: the upload did not reach the server; the recording waits in this tab for Retry.
function Offline({ done, retry }: Props) {
  const t = useTranslations('captures');
  return (
    <>
      <p className="flex items-center gap-2 font-medium">
        <WifiOff aria-hidden className="size-4" />
        {t('offlineTitle')}
      </p>
      <p>{t('offlineStatus')}</p>
      <p className="text-text-muted">{t('offlineSession')}</p>
      <div className="flex gap-2">
        <Button onClick={retry}>{t('retry')}</Button>
        <Button variant="ghost" onClick={done}>
          {t('done')}
        </Button>
      </div>
    </>
  );
}
function Ready({ done }: Props) {
  const t = useTranslations('captures');
  return (
    <>
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck aria-hidden className="size-4 text-success" />
        {t('readyTitle')}
      </p>
      <div className="flex gap-2">
        <ReviewLink label={t('reviewNow')} primary done={done} />
        <Button variant="ghost" onClick={done}>
          {t('later')}
        </Button>
      </div>
    </>
  );
}
const message = (stage: Stage, code: string | null) =>
  stage === 'unavailable' ? 'unavailable' : stage === 'failed' ? failure(code) : 'preparing';
// S11 and S29: saved; preparing, unavailable for now, or failed with its reason.
function Saved({ stage, capture, seconds, done }: Props) {
  const t = useTranslations('captures');
  return (
    <>
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck aria-hidden className="size-4" />
        {t('savedTitle')}
      </p>
      <p>{t(message(stage, capture?.errorCode ?? null))}</p>
      {(stage === 'uploading' || stage === 'working') && (
        <Steps
          uploading={stage === 'uploading'}
          transcribed={Boolean(capture?.transcript)}
          seconds={seconds}
        />
      )}
      <div className="flex gap-2">
        <Button onClick={done}>{t('done')}</Button>
        <ReviewLink label={t('review')} primary={false} done={done} />
      </div>
    </>
  );
}
function Steps({
  uploading,
  transcribed,
  seconds,
}: {
  uploading: boolean;
  transcribed: boolean;
  seconds: number;
}) {
  const t = useTranslations('captures');
  return (
    <ul className="grid gap-1.5">
      <Line step={uploading ? 'active' : 'done'}>
        {t('uploaded')}
        <span aria-hidden className="h-3.5 w-px bg-border" />
        <span dir="ltr" className="tabular-nums">
          {clock(seconds)}
        </span>
      </Line>
      <Line step={uploading ? 'waiting' : transcribed ? 'done' : 'active'}>
        {t('transcribing')}
      </Line>
      <Line step={transcribed ? 'active' : 'waiting'}>{t('preparingDrafts')}</Line>
    </ul>
  );
}
