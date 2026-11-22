'use client';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Info, TriangleAlert } from 'lucide-react';
import { NativeSelect, NativeSelectOption } from '@/ui/primitives/native-select';
import { Priority } from '@/modules/tasks/schema/validation';
import { useAssignablePeople } from './capture-queries';
// The plain controls a draft's fields use, and the notice a field state is said with.
export function OwnerSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations('captures');
  const people = useAssignablePeople();
  return (
    <NativeSelect
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.currentTarget.value || null)}
    >
      <NativeSelectOption value="">{t('noOwner')}</NativeSelectOption>
      {people.map((person) => (
        <NativeSelectOption key={person.id} value={person.id}>
          {person.displayName ?? person.fullName}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
export function PrioritySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations('captures');
  const tasks = useTranslations('tasks');
  return (
    <NativeSelect
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.currentTarget.value || null)}
    >
      <NativeSelectOption value="">{t('unset')}</NativeSelectOption>
      {Priority.options.map((option) => (
        <NativeSelectOption key={option} value={option}>
          {tasks(option)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
export function Notice({
  children,
  tone = 'warning',
}: {
  children: ReactNode;
  tone?: 'warning' | 'info';
}) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <p className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
