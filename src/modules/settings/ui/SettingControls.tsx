'use client';
import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { z } from 'zod';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { Property } from '@/ui/layout/Property';
import { useSaveSetting } from './queries';
import { Setting } from '../schema/validation';
export type SettingRow = z.infer<typeof Setting>;
export type Save = ReturnType<typeof useSaveSetting>['mutate'];
// ADMIN-B07: one setting is one row of a property sheet: its name in the label column, the control
// that suits its type beside it, and a way back to the default once it has left it. Every change
// saves at once; the page says it was saved (or why not) through the shared toast. A `hint` is one
// line of help under the control; the control points at it through aria-describedby with `hintId`.
export function SettingRowFrame({
  label,
  setting,
  save,
  hint,
  hintId,
  children,
}: {
  label: string;
  setting: SettingRow;
  save: Save;
  hint?: ReactNode;
  hintId?: string;
  children: ReactNode;
}) {
  const t = useTranslations('admin');
  const changed = JSON.stringify(setting.value) !== JSON.stringify(setting.default);
  const control = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      {changed && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('resetNamed', { name: label })}
          title={t('reset')}
          className="shrink-0 text-text-faint hover:text-text"
          onClick={() => save({ key: setting.key, value: setting.default })}
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
      )}
    </span>
  );
  return (
    <Property label={label} quiet>
      {hint ? (
        <span className="flex min-w-0 flex-col gap-1 py-1.5">
          {control}
          <span id={hintId} className="text-xs font-light text-text-muted">
            {hint}
          </span>
        </span>
      ) : (
        control
      )}
    </Property>
  );
}
// Free text, saved when the field is left with a changed, non-empty value.
export function TextSetting({
  setting,
  save,
  label,
}: {
  setting: SettingRow;
  save: Save;
  label: string;
}) {
  const value = typeof setting.value === 'string' ? setting.value : '';
  return (
    <SettingRowFrame label={label} setting={setting} save={save}>
      <Input
        key={value}
        aria-label={label}
        defaultValue={value}
        maxLength={200}
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next && next !== value) save({ key: setting.key, value: next });
        }}
      />
    </SettingRowFrame>
  );
}
// A whole number with its unit after it ("30 days"), read left to right in both languages. A
// setting where 0 has a meaning of its own (ADMIN-B48: never) passes `zero`, which says it in words
// in place of the unit while the field holds 0.
export function NumberSetting({
  setting,
  save,
  label,
  unit,
  zero,
  hint,
  min,
  max,
}: {
  setting: SettingRow;
  save: Save;
  label: string;
  unit: string;
  zero?: string;
  hint?: string;
  min: number;
  max: number;
}) {
  const hintId = useId();
  const value = typeof setting.value === 'number' ? setting.value : 0;
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }
  return (
    <SettingRowFrame label={label} setting={setting} save={save} hint={hint} hintId={hintId}>
      <span className="flex items-center gap-2">
        <Input
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          dir="ltr"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          className="w-24 text-start tabular-nums"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            // An empty field is not 0: Number('') would otherwise save "never" by accident.
            const next = draft.trim() === '' ? Number.NaN : Number(draft);
            if (Number.isInteger(next) && next >= min && next <= max && next !== value)
              save({ key: setting.key, value: next });
            else setDraft(String(value));
          }}
        />
        <span className="text-sm font-light text-text-muted">
          {zero !== undefined && draft.trim() !== '' && Number(draft) === 0 ? zero : unit}
        </span>
      </span>
    </SettingRowFrame>
  );
}
// A share of the target, typed as a percentage and stored as the ratio the setting keeps. `onDraft`
// hears every keystroke as a ratio (null while the field holds no usable number), so text beside
// the field can follow what is being typed before it is saved.
export function PercentInput({
  label,
  value,
  commit,
  onDraft,
}: {
  label: string;
  value: number;
  commit: (ratio: number) => void;
  onDraft?: (ratio: number | null) => void;
}) {
  const shown = String(Math.round(value * 1000) / 10);
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setDraft(shown);
  }
  return (
    <span className="flex items-center gap-2">
      <Input
        aria-label={label}
        dir="ltr"
        type="number"
        inputMode="decimal"
        step="0.1"
        value={draft}
        className="w-24 text-start tabular-nums"
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          onDraft?.(event.target.value && Number.isFinite(next) && next > 0 ? next / 100 : null);
        }}
        onBlur={() => {
          const next = Number(draft);
          if (Number.isFinite(next) && next > 0 && draft !== shown) commit(next / 100);
          else {
            setDraft(shown);
            onDraft?.(null);
          }
        }}
      />
      <span className="text-sm font-light text-text-muted">%</span>
    </span>
  );
}
