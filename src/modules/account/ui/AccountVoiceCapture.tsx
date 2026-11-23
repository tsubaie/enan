'use client';
import { useId, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldOff, UserRound } from 'lucide-react';
import { Switch } from '@/ui/primitives/switch';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { usePatchAccount } from './queries';
import type { Account } from '../schema/validation';
type Captures = Account['captures'];
// ACCT-B11: the reader's own voice capture switch and Alt+V (CAPTURES-B15). The shell draws the
// record controls on the server, so a save re-renders it (`router.refresh`) rather than reloading.
// While the workspace has recording off (CAPTURES-B14) the section stays, greyed, with the reason,
// and offers nothing to change.
export function AccountVoiceCapture({ account }: { account: Account }) {
  const t = useTranslations('account');
  const off = useId();
  return (
    <div className="grid gap-3">
      {account.captures.allowed ? (
        <VoiceSwitches account={account} />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <p className="flex items-center gap-2 border-b border-warning bg-warning-soft px-4 py-2.5 text-sm font-medium">
            <ShieldOff aria-hidden className="size-4 shrink-0" />
            {t('voiceOffByAdmin')}
          </p>
          <div className="text-text-muted">
            <Row id={off} title={t('voice')} hint={t('voiceOffByAdminHint')} />
          </div>
        </div>
      )}
      <p className="flex items-start gap-2 text-sm text-text-muted">
        <UserRound aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('voiceSaved')}
      </p>
    </div>
  );
}
function VoiceSwitches({ account }: { account: Account }) {
  const t = useTranslations('account');
  const c = useTranslations('captures');
  const patch = usePatchAccount();
  const router = useRouter();
  const { enabled, shortcut } = account.captures;
  const id = { voice: useId(), shortcut: useId() };
  const save = (captures: Partial<Pick<Captures, 'enabled' | 'shortcut'>>) =>
    patch.mutate(
      { revision: account.user.revision, captures },
      { onSuccess: () => router.refresh() },
    );
  const chip = (key: ReactNode) => (
    <kbd translate="no" className="rounded border px-1.5 py-0.5 font-sans text-xs">
      {key}
    </kbd>
  );
  return (
    <>
      <div className="divide-y rounded-xl border">
        <Row id={id.voice} title={t('voice')} hint={t('voiceHelper')}>
          <Switch
            aria-labelledby={`${id.voice}-title`}
            aria-describedby={`${id.voice}-hint`}
            checked={enabled}
            onCheckedChange={(next) => save({ enabled: next })}
          />
        </Row>
        {/* The chord is a computer's (CAPTURES-B19); a phone has no row for it. */}
        {enabled ? (
          <div className="hidden lg:grid">
            <Row
              id={id.shortcut}
              title={t('voiceShortcut')}
              hint={t('voiceShortcutHint')}
              keys={
                <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  {chip(c('shortcut'))}
                  <span>{t.rich('voiceShortcutMac', { key: (text) => chip(text) })}</span>
                </span>
              }
            >
              <Switch
                aria-labelledby={`${id.shortcut}-title`}
                aria-describedby={`${id.shortcut}-hint`}
                checked={shortcut}
                onCheckedChange={(next) => save({ shortcut: next })}
              />
            </Row>
          </div>
        ) : null}
      </div>
      {patch.error && <ErrorPanel error={patch.error} />}
    </>
  );
}
// One setting: its name, an optional line of keys, its help, and the control (none while greyed).
// The control names itself by `${id}-title` and `${id}-hint`.
function Row({
  id,
  title,
  hint,
  keys,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  keys?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="grid min-w-0 flex-1 gap-1">
        <p id={`${id}-title`} className="font-medium">
          {title}
        </p>
        {keys}
        <p id={`${id}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      </div>
      {children}
    </div>
  );
}
