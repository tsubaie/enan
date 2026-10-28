'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Copy, NotebookPen, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Segmented } from '@/ui/primitives/segmented';
import { Markdown } from '@/ui/markdown/Markdown';
import { AiFailure } from '@/ui/ai/AiFailure';
import { AiRequestError } from '@/ui/ai/AiRequestError';
import { routes } from '@/core/routes';
import { cn } from '@/ui/cn';
import { NarrativeLocale, NarrativePeriod, type Narrative } from '../schema/validation';
import { useKpiLabels } from './use-kpi-labels';
import {
  useNarrative,
  useNarrativeAvailable,
  useSaveBriefAsNote,
  useStartNarrative,
  type BriefScope,
} from './narrative-queries';
// KPIS-B32: an executive brief written from the scorecard's figures, for the whole scorecard or
// one measure. It is folded away behind one control because it is asked for, not read every time;
// it is read against the same comparison period the page is, and it says on its face whether the
// figures it was written from are still the figures on screen.
export function KpiNarrative({ kpiId }: { kpiId?: string }) {
  const t = useTranslations('kpis');
  const available = useNarrativeAvailable();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState(NarrativeLocale.catch('en').parse(useLocale()));
  const period = NarrativePeriod.catch('current').parse(
    useSearchParams().get('period') || 'current',
  );
  const scope: BriefScope = { kpiId, locale: language, period };
  if (!available) return null;
  return (
    <section className="grid gap-3">
      <Button
        variant="secondary"
        size="sm"
        className="justify-self-start font-light"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles className="size-4" aria-hidden={true} />
        {t('briefOpen')}
        <ChevronDown className={cn('size-3.5', open && 'rotate-180')} aria-hidden={true} />
      </Button>
      {open && (
        <div className="grid gap-4 rounded-2xl border bg-surface px-4 py-4">
          <Segmented
            label={t('briefLanguage')}
            value={language}
            segments={[
              { value: 'en', label: t('briefEnglish') },
              { value: 'ar', label: t('briefArabic') },
            ]}
            onChange={setLanguage}
          />
          <BriefBody scope={scope} />
        </div>
      )}
    </section>
  );
}
function BriefBody({ scope }: { scope: BriefScope }) {
  const t = useTranslations('kpis');
  const query = useNarrative(scope, true);
  const start = useStartNarrative(scope);
  const view = query.data?.data;
  const narrative = view?.narrative ?? null;
  const writing = start.isPending || narrative?.status === 'generating';
  return (
    <div className="grid gap-3" aria-busy={writing}>
      <div className="flex flex-wrap items-center gap-2">
        {narrative?.status === 'ready' && <Freshness stale={Boolean(view?.isStale)} />}
        <Button size="sm" variant="outline" disabled={writing} onClick={() => start.mutate()}>
          <RefreshCw className="size-4" aria-hidden={true} />
          {t(narrative ? 'briefRewrite' : 'briefWrite')}
        </Button>
      </div>
      <BriefState
        narrative={narrative}
        writing={writing}
        loading={query.isPending}
        error={start.error ?? query.error}
      />
    </div>
  );
}
// Exactly one of: being written, not written yet, a request that failed, a job that failed, or
// the brief itself.
function BriefState({
  narrative,
  writing,
  loading,
  error,
}: {
  narrative: Narrative | null;
  writing: boolean;
  loading: boolean;
  error: Error | null;
}) {
  const t = useTranslations('kpis');
  if (error) return <AiRequestError error={error} />;
  if (writing || (!narrative && !loading))
    return (
      <p role="status" className="m-0 text-sm text-text-muted">
        {t(writing ? 'briefWriting' : 'briefEmpty')}
      </p>
    );
  if (narrative?.status === 'failed') return <AiFailure reason={narrative.error} />;
  return narrative?.status === 'ready' ? <Brief narrative={narrative} /> : null;
}
// Grounded when the digest of the figures it was written from is the digest of the figures now.
function Freshness({ stale }: { stale: boolean }) {
  const t = useTranslations('kpis');
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-medium',
        stale ? 'bg-warning-soft text-warning' : 'bg-surface-raised text-success',
      )}
    >
      {t(stale ? 'briefStale' : 'briefGrounded')}
    </span>
  );
}
function Brief({ narrative }: { narrative: Narrative }) {
  const dir = narrative.locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <article dir={dir} lang={narrative.locale} className="grid gap-3">
      <h3 className="m-0 text-base font-medium">{narrative.headline}</h3>
      <Markdown content={narrative.bodyMarkdown ?? ''} interactive={false} />
      <Citations narrative={narrative} />
      <BriefActions narrative={narrative} />
    </article>
  );
}
// Each measure the brief cites is a chip that opens it, in the colour of its status, with its code
// isolated so a Latin code never reorders an Arabic sentence around it.
function Citations({ narrative }: { narrative: Narrative }) {
  const t = useTranslations('kpis');
  const labels = useKpiLabels();
  if (!narrative.highlights.length) return null;
  return (
    <ul aria-label={t('briefCitations')} className="m-0 grid list-none gap-2 p-0">
      {narrative.highlights.map((highlight) => (
        <li key={highlight.code} className="grid gap-1 text-sm">
          <Link
            href={routes.kpis({ id: highlight.kpiId })}
            className={cn(
              'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
              labels.chip(highlight.status),
            )}
          >
            <bdi dir="ltr">{highlight.code}</bdi>
            <span dir="auto">{highlight.name}</span>
          </Link>
          <span className="text-text-muted">{highlight.summary}</span>
        </li>
      ))}
    </ul>
  );
}
function BriefActions({ narrative }: { narrative: Narrative }) {
  const t = useTranslations('kpis');
  const [copied, setCopied] = useState(false);
  const save = useSaveBriefAsNote();
  const text = `${narrative.headline ?? ''}\n\n${narrative.bodyMarkdown ?? ''}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      >
        <Copy className="size-4" aria-hidden={true} />
        {t(copied ? 'briefCopied' : 'briefCopy')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={save.isPending || save.isSuccess}
        onClick={() => save.mutate({ title: narrative.headline ?? t('briefOpen'), content: text })}
      >
        <NotebookPen className="size-4" aria-hidden={true} />
        {t(save.isSuccess ? 'briefSaved' : 'briefSave')}
      </Button>
      {save.error && <AiRequestError error={save.error} />}
    </div>
  );
}
