'use client';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import type { Person } from '../schema/validation';
import type { DetailApi } from '@/ui/entity/types';
import { EntityFooter, EntityUpdated } from '@/ui/entity/EntityFooter';
import { Button } from '@/ui/primitives/button';
import { PersonForm, type Patch } from './PersonForm';
import { OwnerTasks } from '@/modules/tasks/ui';
import { PersonNotes } from '@/modules/notes/ui';
import { initials } from '@/ui/format';
import { RecordTitle } from '@/ui/layout/Record';
import { RecordTitleField } from '@/ui/layout/RecordTitleField';
export function PersonDetail({ person, api }: { person: Person; api: DetailApi<Patch> }) {
  const t = useTranslations('people');
  const c = useTranslations('common');
  return (
    <div>
      {/* The person's face and their name, which is the editable heading; what they do lives in its
          own rows on the sheet below, so it is not repeated here. */}
      <div className="mb-6 flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface-raised text-lg text-text">
          <bdi>{initials(person.fullName)}</bdi>
        </span>
        <div className="min-w-0 flex-1">
          {person.deletedAt ? (
            <RecordTitle className="px-0">{person.fullName}</RecordTitle>
          ) : (
            <RecordTitleField
              kind="name"
              value={person.fullName}
              label={t('fullName')}
              className="-ms-2"
              save={(fullName) => api.save({ fullName })}
            />
          )}
        </div>
      </div>
      {person.deletedAt ? (
        <div className="grid gap-4">
          <p>{t('deleted')}</p>
          <Button onClick={api.restore}>
            <RotateCcw className="size-4" />
            {c('restore')}
          </Button>
        </div>
      ) : (
        <>
          <PersonForm initial={person} save={api.save} />
          <OwnerTasks personId={person.id} />
          <PersonNotes personId={person.id} />
          <EntityFooter remove={api.remove}>
            <EntityUpdated at={person.updatedAt} />
          </EntityFooter>
        </>
      )}
    </div>
  );
}
