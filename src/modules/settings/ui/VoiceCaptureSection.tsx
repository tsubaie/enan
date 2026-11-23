'use client';
import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, CircleCheck, CircleOff } from 'lucide-react';
import { routes } from '@/core/routes';
import { Switch } from '@/ui/primitives/switch';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { RecordSection } from '@/ui/layout/Record';
import { SettingRowFrame, type Save, type SettingRow } from './SettingControls';
type Rows = (key: string) => SettingRow | undefined;
// ADMIN-B77: the workspace's recording switch (`captures.enabled`, CAPTURES-B14) and, read-only,
// the AI capability that turns recordings into drafts, which lives on the AI page. Turning that
// capability off never hides a record control, so the two are kept apart here.
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
    </RecordSection>
  );
}
