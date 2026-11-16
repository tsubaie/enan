'use client';
import { Suspense, lazy, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/primitives/popover';
import { cn } from '@/ui/cn';
import { usePlainDate, useToday } from '@/ui/format';
export type DatePickerProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  name?: string;
  // Shows a × at the end of the field while a day is set; picking it reports null.
  clearable?: boolean;
  tone?: 'danger' | 'accent' | 'muted';
  size?: 'sm' | 'default';
  className?: string;
};
const Panel = lazy(() => import('./DatePickerPanel'));
// Date field: a labelled trigger showing the chosen day, opening quick picks and a month grid
// (loaded on first open). `name` adds a hidden input for plain form submission.
export function DatePicker({
  value,
  onChange,
  label,
  name,
  clearable = false,
  tone = 'muted',
  size = 'default',
  className,
}: DatePickerProps) {
  const t = useTranslations('common');
  const today = useToday();
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLSpanElement>(null);
  const pick = (day: string) => {
    onChange(day);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <span ref={field} className="relative flex min-w-0">
        <DateTrigger
          value={value}
          label={label}
          tone={tone}
          size={size}
          className={cn(clearable && value && 'pe-9 pointer-coarse:pe-12', className)}
        />
        {clearable && value && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('clearDate')}
            className="absolute inset-y-0 end-1 my-auto text-text-muted pointer-coarse:size-11"
            onClick={() => {
              // The × leaves with the value; focus goes back to the field rather than the page.
              field.current?.querySelector('button')?.focus();
              onChange(null);
            }}
          >
            <X aria-hidden />
          </Button>
        )}
      </span>
      <PopoverContent className="w-[19.5rem]" aria-label={t('pickDate')}>
        <Suspense fallback={<div className="h-72" />}>
          <Panel value={value} today={today} pick={pick} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
function DateTrigger({
  value,
  label,
  tone,
  size,
  className,
}: Pick<DatePickerProps, 'value' | 'label'> & {
  className: string | undefined;
  tone: NonNullable<DatePickerProps['tone']>;
  size: NonNullable<DatePickerProps['size']>;
}) {
  const t = useTranslations('common');
  const plainDate = usePlainDate();
  return (
    <PopoverTrigger
      aria-label={label}
      render={
        <Button
          variant="outline"
          size={size === 'sm' ? 'sm' : 'default'}
          className={cn(
            'w-full justify-start gap-2 font-normal',
            size === 'sm' && 'min-h-7 text-xs',
            !value && 'text-text-muted',
            value && tone === 'danger' && 'text-danger',
            value && tone === 'accent' && 'text-accent',
            className,
          )}
        />
      }
    >
      <CalendarDays className="size-4 shrink-0" />
      <span className="truncate">{value ? plainDate(value) : t('noDate')}</span>
    </PopoverTrigger>
  );
}
