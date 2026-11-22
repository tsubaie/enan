'use client';
import { useTranslations } from 'next-intl';
import { Building2, CalendarDays, CircleCheck, FileText, TriangleAlert, User } from 'lucide-react';
import { usePlainDate } from '@/ui/format';
import { useCommitteeChoices } from '@/modules/committees/ui';
import { useNoteTypes, useTypeLabel } from '@/modules/notes/ui';
import {
  payloadFields,
  type Approval,
  type PayloadFields,
  type RequiredField,
  type Suggestion,
} from '../schema/validation';
import { fieldStateOf } from './SuggestionFields';
import { useAssignablePeople } from './capture-queries';
// The words a draft is shown with: its values at a glance, and the receipt once it is approved.
export function Meta({ payload }: { payload: PayloadFields }) {
  const date = usePlainDate();
  const people = useAssignablePeople();
  const committees = useCommitteeChoices().data?.data ?? [];
  const types = useNoteTypes().data?.data;
  const typeLabel = useTypeLabel(types);
  const value = (key: string) => {
    const field = payload[key];
    return typeof field === 'string' ? field : null;
  };
  const owner = people.find((person) => person.id === value('ownerId'));
  const committee = committees.find((row) => row.id === value('committeeId'));
  const day = value('dueDate') ?? value('noteDate');
  const type = value('type');
  const items = [
    owner && { icon: User, text: owner.displayName ?? owner.fullName },
    type && { icon: FileText, text: typeLabel(type) },
    day && { icon: CalendarDays, text: date(day) },
    committee && { icon: Building2, text: committee.name },
  ].filter((item) => Boolean(item));
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
      {items.map((item) =>
        item ? (
          <li key={item.text} className="flex items-center gap-1">
            <item.icon aria-hidden className="size-4" />
            {item.text}
          </li>
        ) : null,
      )}
    </ul>
  );
}
// S26: the sentence the toast reads for one approved draft.
export function useApprovedMessage() {
  const t = useTranslations('captures');
  const committees = useCommitteeChoices().data?.data ?? [];
  return (approval: Approval) => {
    const payload = payloadFields(approval.suggestion.payload);
    const title = payload.title?.toString() ?? '';
    if (approval.suggestion.kind === 'task') return t('approvedTask', { title });
    if (approval.suggestion.kind === 'meeting_note') return t('approvedMeeting', { title });
    const committee = committees.find((row) => row.id === payload.committeeId)?.name;
    return committee ? t('approvedCommittee', { committee }) : t('approvedNote', { title });
  };
}
// A draft's state in words and an icon (CAPTURES-B09): Ready, or what still has to be chosen, and
// the non-blocking flag of an unmatched owner.
export function DraftState({ draft, missing }: { draft: Suggestion; missing: RequiredField[] }) {
  const t = useTranslations('captures');
  const ownerUnsettled = draft.kind === 'task' && fieldStateOf(draft, 'ownerId') !== 'confident';
  const first = missing[0];
  return (
    <span className="flex items-center gap-3 text-sm">
      {ownerUnsettled && (
        <span className="flex items-center gap-1">
          <TriangleAlert aria-hidden className="size-4" />
          {t('nonBlocking')}
        </span>
      )}
      {first ? (
        <span className="flex items-center gap-1 font-medium">
          <TriangleAlert aria-hidden className="size-4" />
          {first === 'committeeId'
            ? t('choose_committeeId')
            : first === 'type'
              ? t('choose_type')
              : t('requiredField')}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-success">
          <CircleCheck aria-hidden className="size-4" />
          {t('ready')}
        </span>
      )}
    </span>
  );
}
