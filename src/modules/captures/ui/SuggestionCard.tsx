'use client';
import { use, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Info, ListChecks, LoaderCircle, NotebookPen } from 'lucide-react';
import { NativeSelect, NativeSelectOption } from '@/ui/primitives/native-select';
import { Dialog, DialogContent, DialogTitle } from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { cn } from '@/ui/cn';
import {
  SuggestionKind,
  blockers,
  payloadFields,
  type CaptureGroup,
  type Suggestion,
} from '../schema/validation';
import { useReviewMutations } from './capture-queries';
import { DraftState, Meta } from './suggestion-text';
import { CaptureListen } from './CaptureListen';
import { SuggestionFields } from './SuggestionFields';
import { focusAfterLeaving, mergeChange, useReviewAction, type Change } from './review-action';
import { InboxContext } from './inbox-state';
import { CardContext, useCard, type Busy, type Card, type Layout } from './suggestion-card-context';
import { ApproveButton, DiscardButton } from './SuggestionButtons';
import { Button } from '@/ui/primitives/button';
export type { Layout } from './suggestion-card-context';
const kindIcons = { task: ListChecks, meeting_note: NotebookPen, committee_note: Building2 };
// The draft as last saved, its edits, and Approve or Discard. Either one asked for while an edit
// is being saved waits for it and is sent with the revision the save answered (CAPTURES-B10).
function useDraftReview(given: Suggestion, cardRef: RefObject<HTMLElement | null>) {
  const mutations = useReviewMutations();
  // The answer of the last edit, until the inbox's own read catches up with it; the ref is read
  // by an action queued behind the save.
  const [latest, setLatest] = useState<Suggestion | null>(null);
  const saved = useRef<Suggestion | null>(null);
  const draft = latest && latest.revision > given.revision ? latest : given;
  const { error, busy, waiting, run } = useReviewAction<Busy>('save');
  const saves = use(InboxContext)?.saves;
  // B6: an edit made while another is being saved is not dropped. Edits wait here, merged (the
  // latest value of each field and the latest kind win), for one PATCH chained after the one in
  // flight, sent with the revision that one answered.
  const pending = useRef<Change | null>(null);
  const save = (change: Change) => {
    const queued = pending.current;
    pending.current = mergeChange(queued, change);
    if (queued) return;
    const done = run('save', async () => {
      const next = pending.current ?? {};
      pending.current = null;
      const fresh = saved.current;
      const base = fresh && fresh.revision > draft.revision ? fresh : draft;
      saved.current = (await mutations.patch(base, next)).data;
      setLatest(saved.current);
    });
    // A save that failed, or was never sent because the one ahead failed, takes its queue along,
    // so the next edit starts a save of its own.
    void done?.then((ok) => ok || (pending.current = null));
    if (done) saves?.set(draft.id, done);
    else pending.current = null;
  };
  const leave: Card['leave'] = (kind, action) => {
    const refocus = focusAfterLeaving(cardRef.current, draft.id);
    run(kind, () => {
      const fresh = saved.current;
      return action(fresh && fresh.revision > draft.revision ? fresh : draft).then(refocus);
    });
  };
  return { draft, error, busy, waiting, save, leave };
}
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
  const cardRef = useRef<HTMLElement>(null);
  const { draft, error, busy, waiting, save, leave } = useDraftReview(given, cardRef);
  const missing = blockers(draft);
  const unsettled =
    missing.length > 0 ||
    Object.values(draft.fieldStates).some((entry) => entry.state !== 'confident');
  const [toggled, setEditing] = useState<boolean | null>(null);
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
    busy,
    waiting,
    leave,
  };
  return (
    <CardContext value={card}>
      <article
        ref={cardRef}
        tabIndex={-1}
        data-draft={draft.id}
        aria-label={payloadFields(draft.payload).title?.toString()}
        data-testid="suggestion-card"
        data-kind={draft.kind}
        className={cn(
          'grid gap-3 rounded-xl border bg-elevated p-4',
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
// S18 Approve / Edit / Discard; the reason Approve waits is said under it (S22).
function Actions() {
  const t = useTranslations('captures');
  const { layout, missing, editing, setEditing, error, waiting } = useCard();
  const reason = useId();
  const [screen, setScreen] = useState(false);
  const first = missing[0];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ApproveButton reason={reason} />
        {layout !== 'screen' && (
          <Button
            variant="outline"
            aria-expanded={layout === 'panel' ? editing : undefined}
            onClick={() => (layout === 'compact' ? setScreen(true) : setEditing(!editing))}
          >
            {t('edit')}
          </Button>
        )}
        <DiscardButton />
      </div>
      {waiting ? (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
          <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
          {t('savingChange')}
        </p>
      ) : (
        first && (
          <p id={reason} className="flex items-center gap-1.5 text-sm font-medium">
            <Info aria-hidden className="size-4" />
            {t(`blocked_${first}`)}
          </p>
        )
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
