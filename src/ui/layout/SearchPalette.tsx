'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { clientModules } from '@/core/modules/client';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/ui/primitives/dialog';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { HitSubtitle, Matched } from './search-hit';
import { useSearchPalette, type SearchScope } from './search-palette-store';
const Hit = z.object({
  module: z.string(),
  id: z.uuid(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  href: z.string(),
  rank: z.union([z.literal(0), z.literal(1)]),
});
const Result = z.object({
  data: z.object({ hits: z.array(Hit), unavailable: z.array(z.string()) }),
});
type Hit = z.infer<typeof Hit>;
// SEARCH-B02: the floor is applied here as well as on the server so that one and two characters
// never cost a request.
const MIN = 2;
// `initialQuery` is the phrase the palette opens holding — empty from the header control and the
// chord, the list's own query when its no-matches state hands the search over (EP-B41).
type PaletteProps = { open: boolean; initialQuery?: string; onOpenChange: (open: boolean) => void };
// SEARCH-B09: the key carries the debounced query, so a superseded request resolves into its own
// cache entry and can never overwrite a newer one's results.
function useSearchResults(open: boolean, query: string) {
  const debounced = useDebounced(query, 200);
  return useQuery({
    queryKey: ['search', debounced],
    enabled: open && debounced.trim().length >= MIN,
    staleTime: 30_000,
    queryFn: () => request(`/search?q=${encodeURIComponent(debounced)}`, Result),
  });
}
// After Spotlight: a rounded glass panel in the upper third of the screen rather than at its centre,
// a large search field, results in sentence-case groups (ADR 0031).
export function SearchPalette({ open, initialQuery = '', onOpenChange }: PaletteProps) {
  const t = useTranslations('common');
  const router = useRouter();
  const { scope } = useSearchPalette();
  const [query, setQuery] = useState(initialQuery);
  const results = useSearchResults(open, query);
  // Closing clears the query, wherever the close came from — Esc, the overlay, or opening a hit.
  // A palette that reopens holding the last search is offering an answer to a question the reader
  // has already finished asking.
  const change = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };
  const hits = results.data?.data.hits ?? [];
  const open_ = (hit: Hit) => {
    change(false);
    router.push(hit.href);
  };
  // SEARCH-B12: the list on screen takes the phrase and filters in place; the palette closes.
  const handOver = () => {
    change(false);
    scope?.search(query.trim());
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        sheet
        showCloseButton={false}
        className="search-palette gap-0 overflow-hidden rounded-t-[22px] p-0 lg:top-[18dvh] lg:max-w-[680px] lg:translate-y-0 lg:rounded-[22px]"
      >
        <DialogTitle className="sr-only">{t('search')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <PaletteField query={query} onQuery={setQuery} />
        <PaletteBody
          query={query}
          pending={results.isFetching}
          hits={hits}
          unavailable={results.data?.data.unavailable ?? []}
          onOpen={open_}
          scope={scope}
          onScope={handOver}
        />
      </DialogContent>
    </Dialog>
  );
}
// Spotlight's field: a magnifier and 20 px medium type across the panel's head.
function PaletteField({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  const t = useTranslations('common');
  return (
    <>
      <div className="flex items-center gap-3 px-5">
        <Search
          aria-hidden={true}
          className="size-4 shrink-0 text-text-muted lg:size-5"
          strokeWidth={2}
        />
        <Input
          autoFocus
          type="search"
          autoComplete="off"
          spellCheck={false}
          aria-label={t('search')}
          placeholder={t('searchPlaceholder')}
          className="h-12 border-0 bg-transparent px-0 text-base font-light focus-visible:ring-0 dark:bg-transparent lg:h-14 lg:text-xl lg:font-medium"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      {/* The rule under the field stops short of the panel's edges, as Spotlight's does. */}
      <div aria-hidden={true} className="mx-5 h-px bg-white/10" />
    </>
  );
}
function PaletteBody({
  query,
  pending,
  hits,
  unavailable,
  onOpen,
  scope,
  onScope,
}: {
  query: string;
  pending: boolean;
  hits: Hit[];
  unavailable: string[];
  onOpen: (hit: Hit) => void;
  scope: SearchScope | null;
  onScope: () => void;
}) {
  const t = useTranslations('common');
  const short = query.trim().length < MIN;
  return (
    <div className="max-h-[56dvh] min-h-24 overflow-y-auto p-2">
      {/* SEARCH-B12: opened over an entity list, the first row offers the phrase to that list.
          A reader who typed it here and then sees it belongs in the module they were already in
          does not retype it into the field one row below. */}
      {scope && !short && (
        <Button
          variant="ghost"
          className="mb-1 h-auto w-full justify-start gap-2.5 px-2 py-2 text-start font-normal"
          onClick={onScope}
        >
          <Search aria-hidden={true} className="size-4 shrink-0 text-text-muted" />
          <span className="truncate" dir="auto">
            {t('searchScope', { module: scope.label, query: query.trim() })}
          </span>
        </Button>
      )}
      {unavailable.length > 0 && (
        <p role="status" className="px-2 py-1.5 text-xs text-warning">
          {t('searchUnavailable', { modules: unavailable.length })}
        </p>
      )}
      {short ? (
        <p className="px-2 py-6 text-center text-sm text-text-muted">{t('searchHint')}</p>
      ) : hits.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-text-muted">
          {pending ? t('loading') : t('searchEmpty')}
        </p>
      ) : (
        <Grouped hits={hits} onOpen={onOpen} query={query.trim()} />
      )}
    </div>
  );
}
// SEARCH-B03: the server interleaves so that every module that matched is visible; the palette
// regroups them under their module heading, which is how a reader scans a mixed result.
function Grouped({
  hits,
  onOpen,
  query,
}: {
  hits: Hit[];
  onOpen: (hit: Hit) => void;
  query: string;
}) {
  const t = useTranslations('common');
  const groups = useMemo(() => {
    const byModule = new Map<string, Hit[]>();
    for (const hit of hits) byModule.set(hit.module, [...(byModule.get(hit.module) ?? []), hit]);
    return [...byModule];
  }, [hits]);
  return (
    <>
      {groups.map(([module, items]) => {
        const manifest = clientModules.find((entry) => entry.id === module);
        const Icon = manifest?.nav?.icon;
        return (
          <section key={module} className="mb-2">
            <h2 className="mx-3 mt-3 mb-1 border-b border-white/10 pb-1.5 text-sm font-semibold text-text-muted">
              {manifest?.nav ? t(manifest.nav.key) : module}
            </h2>
            {items.map((hit) => (
              <Button
                key={hit.id}
                variant="ghost"
                className="spotlight-hit h-auto w-full justify-start gap-3 rounded-xl border-0 px-3 py-2.5 text-start font-normal focus-visible:ring-0"
                onClick={() => onOpen(hit)}
              >
                {Icon && <Icon aria-hidden={true} className="size-4 shrink-0 text-text-muted" />}
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate" dir="auto">
                    <Matched text={hit.title} query={query} />
                  </span>
                  {hit.subtitle && (
                    <span className="truncate text-start text-xs font-light text-text-muted">
                      <HitSubtitle text={hit.subtitle} />
                    </span>
                  )}
                </span>
              </Button>
            ))}
          </section>
        );
      })}
    </>
  );
}
function useDebounced(value: string, delay: number) {
  const [settled, setSettled] = useState(value);
  // SEARCH-B09 holds the query back until typing settles, so a reader mid-word does not spend a
  // request per keystroke.
  // sync: external system — the clock.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
