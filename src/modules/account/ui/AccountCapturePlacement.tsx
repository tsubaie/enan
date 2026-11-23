'use client';
import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { DesktopChoice, FloatingSide, MobileChoice } from '@/core/config/capture-placement';
import { RadioCard } from '@/ui/primitives/radio-card';
import { cn } from '@/ui/cn';
import type { Account, AccountPatch } from '../schema/validation';
type Captures = Account['captures'];
type Save = (patch: NonNullable<AccountPatch['captures']>) => void;
// ACCT-B11 CAPTURES-B16: where the reader's record control lives, as radio lists: the phone's on a
// phone and the computer's on a computer (CSS only, so a phone does not edit the computer's), each
// led by "Workspace default (…)" naming the workspace's current value. `workspace` clears the
// reader's row on the server.
export function AccountCapturePlacement({ captures, save }: { captures: Captures; save: Save }) {
  return (
    <>
      <div className="grid gap-3 px-4 py-3.5 lg:hidden">
        <PhonePlacement captures={captures} save={save} />
        {captures.mobile === 'floating' ? <SidePicker side={captures.side} save={save} /> : null}
      </div>
      <div className="hidden px-4 py-3.5 lg:grid">
        <ComputerPlacement captures={captures} save={save} />
      </div>
    </>
  );
}
// Choosing Floating afresh starts at End.
function PhonePlacement({ captures, save }: { captures: Captures; save: Save }) {
  const t = useTranslations('account');
  const c = useTranslations('captures');
  const id = useId();
  const options: [MobileChoice, string][] = [
    [
      'workspace',
      t('voiceWorkspaceDefault', { value: c(`placement_${captures.workspaceMobile}`) }),
    ],
    ['floating', t('voiceFloating')],
    ['more', c('placement_more')],
  ];
  return (
    <Group id={id} title={t('voiceRecordButton')} hint={t('voicePhone')}>
      {options.map(([value, label]) => (
        <RadioCard
          key={value}
          name={id}
          checked={captures.mobile === value}
          onChange={() =>
            save(value === 'floating' ? { mobile: value, side: 'end' } : { mobile: value })
          }
        >
          {label}
        </RadioCard>
      ))}
    </Group>
  );
}
// The side is stored as the logical start or end; each card names the physical side it is in the
// reader's language, and its little screen puts the dot there.
function SidePicker({ side, save }: { side: FloatingSide; save: Save }) {
  const t = useTranslations('account');
  const id = useId();
  const options: [FloatingSide, string, string][] = [
    ['start', t('voiceStart'), t('voiceStartCaption')],
    ['end', t('voiceEnd'), t('voiceEndCaption')],
  ];
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-title`}
      className="grid grid-cols-2 gap-3 border-t pt-3"
    >
      <p id={`${id}-title`} className="col-span-2 font-medium">
        {t('voiceSide')}
      </p>
      {options.map(([value, label, caption]) => (
        <RadioCard
          key={value}
          name={id}
          className="items-start"
          checked={side === value}
          onChange={() => save({ side: value })}
        >
          <span
            aria-hidden
            className="relative h-10 w-6 shrink-0 rounded-md border-2 border-text-muted"
          >
            <span
              className={cn(
                'absolute bottom-1.5 size-1.5 rounded-full bg-accent',
                value === 'start' ? 'start-0.5' : 'end-0.5',
              )}
            />
          </span>
          <span className="grid">
            <span className="font-medium">{label}</span>
            <span className="text-sm text-text-muted">{caption}</span>
          </span>
        </RadioCard>
      ))}
    </div>
  );
}
function ComputerPlacement({ captures, save }: { captures: Captures; save: Save }) {
  const t = useTranslations('account');
  const c = useTranslations('captures');
  const id = useId();
  const options: [DesktopChoice, string][] = [
    [
      'workspace',
      t('voiceWorkspaceDefault', { value: c(`placement_${captures.workspaceDesktop}`) }),
    ],
    ['header', c('placement_header')],
    ['account-menu', c('placement_account-menu')],
    ['hidden', c('placement_hidden')],
  ];
  return (
    <Group id={id} title={t('voiceRecordButton')} hint={t('voiceComputer')}>
      {options.map(([value, label]) => (
        <RadioCard
          key={value}
          name={id}
          className="max-w-md"
          checked={captures.desktop === value}
          onChange={() => save({ desktop: value })}
        >
          {label}
        </RadioCard>
      ))}
    </Group>
  );
}
// A radio list under its title and a line naming the device it is for.
function Group({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div role="radiogroup" aria-labelledby={`${id}-title ${id}-hint`} className="grid gap-2">
      <div className="grid gap-0.5">
        <p id={`${id}-title`} className="font-medium">
          {title}
        </p>
        <p id={`${id}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      </div>
      {children}
    </div>
  );
}
