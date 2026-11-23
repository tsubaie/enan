'use client';
import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, CircleCheck, CircleOff, Info } from 'lucide-react';
import { routes } from '@/core/routes';
import { Switch } from '@/ui/primitives/switch';
import { RadioCard } from '@/ui/primitives/radio-card';
import { DesktopPlacement, MobilePlacement } from '@/core/config/capture-placement';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { RecordSection } from '@/ui/layout/Record';
import { SettingRowFrame, type Save, type SettingRow } from './SettingControls';
type Rows = (key: string) => SettingRow | undefined;
// ADMIN-B77: the workspace's recording switch (`captures.enabled`, CAPTURES-B14) and, read-only,
// the AI capability that turns recordings into drafts, which lives on the AI page. Turning that
// capability off never hides a record control, so the two are kept apart here. Below them, where a
// member who has not chosen finds the record control (CAPTURES-B16).
export function VoiceCaptureSection({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const hintId = useId();
  const setting = row('captures.enabled');
  const capabilities = row('ai.enabled_capabilities')?.value;
  const drafts = Array.isArray(capabilities) && capabilities.includes('captures.interpret');
  if (!setting) return null;
  return (
    <RecordSection title={t('voiceCapture')}>
      <p className="text-sm font-light text-text-muted">{t('voiceCaptureIntro')}</p>
      <PropertySheet>
        <SettingRowFrame
          label={t('voiceCaptureAllow')}
          setting={setting}
          save={save}
          hint={t('voiceCaptureHelper')}
          hintId={hintId}
        >
          <span className="flex items-center gap-2">
            <Switch
              aria-label={t('voiceCaptureAllow')}
              aria-describedby={hintId}
              checked={setting.value === true}
              onCheckedChange={(value) => save({ key: setting.key, value })}
            />
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              {t('voiceCaptureNew')}
            </span>
          </span>
        </SettingRowFrame>
        <Property label={t('aiFeature_captures_interpret')} quiet>
          <span className="flex min-w-0 flex-col items-start gap-1 py-1.5">
            <span className="inline-flex items-center gap-1.5 font-medium">
              {drafts ? (
                <CircleCheck aria-hidden className="size-4 text-accent" />
              ) : (
                <CircleOff aria-hidden className="size-4 text-text-muted" />
              )}
              {drafts ? t('voiceCaptureAiOn') : t('voiceCaptureAiOff')}
            </span>
            <span className="text-xs font-light text-text-muted">{t('voiceCaptureAi')}</span>
            <Link
              href={routes.admin('ai')}
              className="inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline"
            >
              {t('voiceCaptureOpenAi')}
              <ChevronRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
            </Link>
          </span>
        </Property>
      </PropertySheet>
      <DefaultPlacement row={row} save={save} />
    </RecordSection>
  );
}
const placements: Record<PlacementKey, readonly (MobilePlacement | DesktopPlacement)[]> = {
  'captures.default_mobile_placement': MobilePlacement.options,
  'captures.default_desktop_placement': DesktopPlacement.options,
};
type PlacementKey = 'captures.default_mobile_placement' | 'captures.default_desktop_placement';
// ADMIN-B77: the workspace's default placement, phone and computer side by side. A member who chose
// a placement keeps it; one on Workspace default follows the change.
function DefaultPlacement({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const c = useTranslations('captures');
  const id = useId();
  const groups: [PlacementKey, string][] = [
    ['captures.default_mobile_placement', t('voicePlacementPhone')],
    ['captures.default_desktop_placement', t('voicePlacementComputer')],
  ];
  return (
    <div className="grid gap-3 pt-4">
      <div className="grid gap-0.5">
        <h4 className="font-medium">{t('voicePlacement')}</h4>
        <p className="text-sm font-light text-text-muted">{t('voicePlacementIntro')}</p>
      </div>
      <div className="grid divide-y rounded-xl border md:grid-cols-2 md:divide-x md:divide-y-0 rtl:md:divide-x-reverse">
        {groups.map(([key, title]) => {
          const setting = row(key);
          return setting ? (
            <div
              key={key}
              role="radiogroup"
              aria-labelledby={`${id}-${key}`}
              className="grid content-start gap-2 p-4"
            >
              <p id={`${id}-${key}`} className="font-medium">
                {title}
              </p>
              {placements[key].map((value) => (
                <RadioCard
                  key={value}
                  name={`${id}-${key}`}
                  checked={setting.value === value}
                  onChange={() => save({ key, value })}
                >
                  {c(`placement_${value}`)}
                </RadioCard>
              ))}
            </div>
          ) : null;
        })}
      </div>
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <Info aria-hidden className="size-4 shrink-0" />
        {t('voicePlacementKept')}
      </p>
    </div>
  );
}
