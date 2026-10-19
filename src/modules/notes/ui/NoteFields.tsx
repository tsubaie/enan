'use client';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RecordTitleField } from '@/ui/layout/RecordTitleField';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { MarkdownField } from '@/ui/markdown/MarkdownField';
import type { ExpandReview } from '@/ui/markdown/ExpandedField';
import type { NoteDetail, NotePatch } from '../schema/validation';
import type { DetailApi } from '@/ui/entity/types';
import { useMentions } from './use-mentions';
import { TemplateSelect } from './NoteSelects';
import { TypeAndDate, type Properties } from './NoteTypeAndDate';
import { CommitteePicker } from '@/modules/committees/ui';
import { TagsEditor } from './TagsEditor';
import { ParticipantLinks } from './ParticipantLinks';
export type Patch = Omit<NotePatch, 'revision'>;
// NOTES-B18: a proposal under review takes the content field's place in the expanded view: its
// draft is what the field shows and commits, and the review surface rides along.
export type ReviewSlot = {
  value: string;
  onCommit: (value: string) => void;
  review: ExpandReview;
};
type Save = (patch: Patch) => void;
// The detail panel: the title is the heading, then type and date rows, the participants (people
// mentioned in the content, linking to their pages), tags and the markdown content. Every field
// commits on leave through the framework save queue.
export function NoteFields({
  note,
  save,
  focus,
  contentAction,
  contentNotice,
  tagsAction,
  review = null,
}: {
  note: NoteDetail;
  save: Save;
  // EP-B44 / NOTES-B28: which field is in the expanded view, carried in the URL by the page.
  focus: DetailApi<Patch>['focus'];
  // The AI actions belong to the fields they transform, so they arrive as slots rather than
  // floating in a row above the record (NOTES-B22).
  contentAction?: ReactNode;
  // A notice about the content, shown between its label and its text (a rewrite waiting).
  contentNotice?: ReactNode;
  tagsAction?: ReactNode;
  review?: ReviewSlot | null;
}) {
  const committees = useTranslations('committees');
  const { draft, change } = useDraftProperties(note, save);
  const mentions = useMentions(note, save);
  return (
    <fieldset data-autosave className="grid min-w-0 gap-4">
      <NoteTitle title={note.title} save={save} />
      <PropertySheet>
        <TypeAndDate note={note} draft={draft} change={change} />
        <Property label={committees('committee')} quiet empty={!note.committeeId}>
          <CommitteePicker
            value={note.committeeId}
            onChange={(committeeId) => save({ committeeId })}
          />
        </Property>
        <ParticipantLinks participants={note.participants} />
        <TagsEditor tags={note.tags} save={(tags) => save({ tags })} action={tagsAction} />
      </PropertySheet>
      {mentions.error && <ErrorPanel error={mentions.error} />}
      <ContentField
        note={note}
        focus={focus}
        review={review}
        mentions={mentions}
        notice={contentNotice}
        action={<ContentActions note={note} save={save} action={contentAction} />}
      />
    </fieldset>
  );
}
// The content: the note's own text, or a proposal's draft while one is under review (NOTES-B18).
function ContentField({
  note,
  focus,
  review,
  mentions,
  action,
  notice,
}: {
  note: NoteDetail;
  focus: DetailApi<Patch>['focus'];
  review: ReviewSlot | null;
  mentions: ReturnType<typeof useMentions>;
  action: ReactNode;
  notice: ReactNode;
}) {
  const t = useTranslations('notes');
  const c = useTranslations('common');
  const ai = useTranslations('ai');
  return (
    <MarkdownField
      label={review ? ai('viewRewrite') : t('content')}
      notice={notice}
      value={review?.value ?? note.content}
      mentions={mentions.mentions}
      onCommit={review?.onCommit ?? mentions.commit}
      action={action}
      expand={{ ...expandFor(note, focus, c), review: review?.review }}
    />
  );
}
// NOTES-B27: an empty note offers a template to insert, beside whatever the AI slot holds.
function ContentActions({
  note,
  save,
  action,
}: {
  note: NoteDetail;
  save: Save;
  action: ReactNode;
}) {
  const t = useTranslations('notes');
  return (
    <>
      {!note.content.trim() && (
        <TemplateSelect
          value=""
          label={t('insertTemplate')}
          onPick={(_id, body) => body && save({ content: body })}
        />
      )}
      {action}
    </>
  );
}
// EP-B44 / NOTES-B28: the content's expanded view, keyed `content` in the URL and headed by the
// note's title.
function expandFor(
  note: NoteDetail,
  focus: DetailApi<Patch>['focus'],
  c: ReturnType<typeof useTranslations<'common'>>,
) {
  return {
    title: note.title,
    open: focus.key === 'content',
    setOpen: (open: boolean) => focus.set(open ? 'content' : null),
    labels: {
      expand: c('expandContent'),
      collapse: c('collapseContent'),
      description: c('expandedDescription'),
      away: c('inExpandedView'),
    },
  };
}
// Pickers are controlled from a draft re-based on the saved note whenever it changes, without
// remounting, so a picker keeps focus after its own save. A picker reporting the value it already
// shows is not an edit and never writes.
function useDraftProperties(note: NoteDetail, save: Save) {
  const base: Properties = { type: note.type ?? '', noteDate: note.noteDate };
  const [draft, setDraft] = useState(base);
  const [seen, setSeen] = useState(base);
  if (seen.type !== base.type || seen.noteDate !== base.noteDate) {
    setSeen(base);
    setDraft(base);
  }
  const change = (patch: Partial<Properties>) => {
    if (
      (patch.type === undefined || patch.type === draft.type) &&
      (patch.noteDate === undefined || patch.noteDate === draft.noteDate)
    )
      return;
    setDraft((current) => ({ ...current, ...patch }));
    save({
      ...(patch.type !== undefined ? { type: patch.type || null } : {}),
      ...(patch.noteDate ? { noteDate: patch.noteDate } : {}),
    });
  };
  return { draft, change };
}
// The title is the heading itself: Enter commits, the accessible label stays "Note title".
function NoteTitle({ title, save }: { title: string; save: Save }) {
  const t = useTranslations('notes');
  return (
    <RecordTitleField value={title} label={t('title')} save={(next) => save({ title: next })} />
  );
}
