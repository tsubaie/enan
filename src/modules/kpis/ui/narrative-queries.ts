'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { AiAvailability } from '@/core/config/ai-capabilities';
import { NarrativeView, type NarrativeScope } from '../schema/validation';
export type BriefScope = Pick<NarrativeScope, 'kpiId' | 'locale' | 'period'>;
const query = (scope: BriefScope) =>
  new URLSearchParams(
    Object.entries(scope).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
// KPIS-B32: the brief for a scope, polled while it is being written and otherwise read on focus,
// so the freshness badge turns stale as soon as a reading moves the figures under it.
export function useNarrative(scope: BriefScope, enabled: boolean) {
  return useQuery({
    queryKey: ['kpis', 'narrative', scope],
    queryFn: () => request(`/kpis/narrative?${query(scope)}`, NarrativeView),
    enabled,
    refetchInterval: (state) =>
      state.state.data?.data.narrative?.status === 'generating' ? 2000 : false,
  });
}
export function useStartNarrative(scope: BriefScope) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request('/kpis/narrative', NarrativeView, {
        method: 'POST',
        body: {
          locale: scope.locale,
          period: scope.period,
          ...(scope.kpiId ? { kpiId: scope.kpiId } : {}),
        },
      }),
    onSuccess: (data) => client.setQueryData(['kpis', 'narrative', scope], data),
  });
}
// Whether this reader can ask for a brief at all; the same answer every AI control reads.
export function useNarrativeAvailable() {
  const availability = useQuery({
    queryKey: ['ai', 'availability'],
    queryFn: () => request('/ai/availability', z.object({ data: AiAvailability })),
    refetchInterval: 30000,
  });
  return availability.data?.data.capabilities.includes('kpis.narrative') ?? false;
}
// "Save as note": the brief becomes an ordinary note, tagged so the briefs can be found together.
export function useSaveBriefAsNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: { title: string; content: string }) =>
      request('/notes', z.object({ data: z.object({ id: z.uuid() }) }), {
        method: 'POST',
        body: { ...note, tags: ['kpi-brief'] },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notes'] }),
  });
}
