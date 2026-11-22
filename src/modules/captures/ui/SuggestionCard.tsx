'use client';
import { createContext, use, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Check, Info, ListChecks, NotebookPen } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { NativeSelect, NativeSelectOption } from '@/ui/primitives/native-select';
import { Dialog, DialogContent, DialogTitle } from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { cn } from '@/ui/cn';
import {
  SuggestionKind,
  blockers,
  payloadFields,
  type CaptureGroup,
  type PayloadFields,
  type RequiredField,
  type Suggestion,
} from '../schema/validation';
import { useReviewMutations } from './capture-queries';
import { DraftState, Meta, useApprovedMessage } from './suggestion-text';
import { CaptureListen } from './CaptureListen';
import { SuggestionFields, type Edit } from './SuggestionFields';
import { useReviewToast } from './review-toast';
// S18–S22: one draft. `layout` is explicit: `compact` on a phone's list (Edit opens the draft full
// screen), `panel` inline in the desktop inbox, `screen` the phone's full-screen draft.
export type Layout = 'compact' | 'panel' | 'screen';
type Card = {
  draft: Suggestion;
  group: CaptureGroup;
  layout: Layout;
  missing: RequiredField[];
  editing: boolean;
  setEditing: (editing: boolean) => void;
  edit: Edit;
  changeKind: (kind: SuggestionKind) => void;
  error: Error | null;
  run: (action: () => Promise<void>) => void;
};
const CardContext = createContext<Card | null>(null);
function useCard() {
  const card = use(CardContext);
  if (!card) throw new Error('SuggestionCard.Root is missing');
  return card;
}
const kindIcons = { task: ListChecks, meeting_note: NotebookPen, committee_note: Building2 };
function Root({
  draft: given,
  group,
  layout,
  children,
}: {
  draft: Suggestion;
  group: CaptureGroup;
  layout: Layout;
  children: ReactNode;
}) {
  const mutations = useReviewMutations();
  // The answer of the last edit, until the inbox's own read catches up with it.
  const [latest, setLatest] = useState<Suggestion | null>(null);
  const draft = latest && latest.revision > given.revision ? latest : given;
  const missing = blockers(draft);
  const unsettled =
    missing.length > 0 ||
    Object.values(draft.fieldStates).some((entry) => entry.state !== 'confident');
  const [toggled, setEditing] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((failure: Error) => setError(failure));
  };
  const save = (change: { kind?: SuggestionKind; payload?: PayloadFields }) =>
    run(async () => setLatest((await mutations.patch(draft, change)).data));
  const card: Card = {
    draft,
    group,
    layout,
    missing,
    // A draft with anything left unsettled opens inline, so the question is in view (S20, S21).
    editing: layout === 'screen' || (toggled ?? (layout === 'panel' && unsettled)),
    setEditing,
    edit: (payload) => save({ payload }),
    changeKind: (kind) => save({ kind }),
    error,
    run,
  };
  return (
    <CardContext value={card}>
      <article
        aria-label={payloadFields(draft.payload).title?.toString()}
        data-testid="suggestion-card"
        data-kind={draft.kind}
        className={cn(
          'grid gap-3 rounded-xl border bg-surface p-4',
          missing.length > 0 && 'border-warning',
        )}
      >
        {children}
      </article>
    </CardContext>
  );
}
// The type chip, changeable; an uncertain kind reads «Looks like …» (non-blocking). Beside it the
// draft's state in words: Ready, or what still has to be chosen.
function Type() {
  const t = useTranslations('captures');
  const { draft, missing, changeKind } = useCard();
  const Icon = kindIcons[draft.kind];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <Icon aria-hidden className="size-4" />
        <span className="sr-only">{t('draftType')}</span>
        <NativeSelect
          size="sm"
          className="w-auto"
          value={draft.kind}
          onChange={(event) => changeKind(SuggestionKind.parse(event.currentTarget.value))}
        >
          {SuggestionKind.options.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {draft.typeFlag && kind === draft.kind ? t(`typeFlag_${kind}`) : t(`kind_${kind}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <DraftState draft={draft} missing={missing} />
    </div>
  );
}
// The draft at a glance: its title and the values that matter for its kind.
function Summary() {
  const { draft, editing } = useCard();
  const payload = payloadFields(draft.payload);
  if (editing) return null;
  return (
    <div className="grid gap-1">
      <h3 dir="auto" className="font-medium">
        {payload.title?.toString()}
      </h3>
      <Meta payload={payload} />
    </div>
  );
}
// The fields, while the draft is open.
function Fields() {
  const { draft, editing, edit } = useCard();
  if (!editing) return null;
  return <SuggestionFields draft={draft} edit={edit} />;
}
// The source sentence and Listen (CAPTURES-B08), while the draft is open.
function Listen() {
  const { draft, group, editing } = useCard();
  if (!editing) return null;
  return <CaptureListen.Source draft={draft} transcript={group.transcript} />;
}
// S18 Approve / Edit / Discard. Approve with a required field unsettled stays focusable and says
// why under it (S22); Discard has no confirm, its toast offers Undo (S25, S28).
function Actions() {
  const t = useTranslations('captures');
  const { draft, layout, missing, editing, setEditing, run, error } = useCard();
  const mutations = useReviewMutations();
  const toast = useReviewToast();
  const message = useApprovedMessage();
  const reason = useId();
  const [screen, setScreen] = useState(false);
  const first = missing[0];
  const approve = () =>
    run(async () => {
      const approval = (await mutations.approve(draft)).data;
      toast.approved(message(approval), [approval]);
    });
  const discard = () =>
    run(async () => {
      await mutations.discard(draft);
      toast.discarded(draft.id);
    });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-disabled={first ? true : undefined}
          aria-describedby={first ? reason : undefined}
          className={cn(first && 'opacity-60')}
          onClick={() => {
            if (!first) approve();
          }}
        >
          <Check aria-hidden />
          {t('approve')}
        </Button>
        {layout !== 'screen' && (
          <Button
            variant="outline"
            aria-expanded={layout === 'panel' ? editing : undefined}
            onClick={() => (layout === 'compact' ? setScreen(true) : setEditing(!editing))}
          >
            {t('edit')}
          </Button>
        )}
        <Button variant="ghost" className="ms-auto text-danger" onClick={discard}>
          {t('discard')}
        </Button>
      </div>
      {first && (
        <p id={reason} className="flex items-center gap-1.5 text-sm font-medium">
          <Info aria-hidden className="size-4" />
          {t(`blocked_${first}`)}
        </p>
      )}
      {error && <ErrorPanel error={error} />}
      {layout === 'compact' && <DraftScreen open={screen} close={() => setScreen(false)} />}
    </div>
  );
}
// S18 on a phone: opening a draft takes over the screen.
function DraftScreen({ open, close }: { open: boolean; close: () => void }) {
  const t = useTranslations('captures');
  const { draft, group } = useCard();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="inset-0 h-dvh max-w-none translate-none overflow-y-auto rounded-none sm:max-w-none">
        <DialogTitle>{t(`kind_${draft.kind}`)}</DialogTitle>
        <SuggestionCardView draft={draft} group={group} layout="screen" />
      </DialogContent>
    </Dialog>
  );
}
const SuggestionCard = { Root, Type, Summary, Fields, Listen, Actions };
// The usual assembly of the parts.
export function SuggestionCardView(props: {
  draft: Suggestion;
  group: CaptureGroup;
  layout: Layout;
}) {
  return (
    <SuggestionCard.Root {...props}>
      <SuggestionCard.Type />
      <SuggestionCard.Summary />
      <SuggestionCard.Fields />
      <SuggestionCard.Listen />
      <SuggestionCard.Actions />
    </SuggestionCard.Root>
  );
}
