'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request, upload } from '@/core/http/client';
import { PersonList } from '@/modules/people/schema/validation';
import {
  Approval,
  CaptureCount,
  CaptureGroup,
  CaptureList,
  Suggestion,
  type PayloadFields,
  type SuggestionKind,
} from '../schema/validation';
// One key prefix for the list, the count and every detail, so a write refreshes all three
// together and the badge never lags the list.
export const captureKeys = {
  all: ['captures'],
  count: ['captures', 'count'],
  list: ['captures', 'list'],
  detail: (captureId: string) => ['captures', 'detail', captureId],
};
const one = z.object({ data: CaptureGroup });
const working = new Set(['queued', 'transcribing', 'interpreting']);
// S13: the Review badge, read on focus and every minute like the notification bell.
export function useCaptureCount() {
  return useQuery({
    queryKey: captureKeys.count,
    queryFn: () => request('/captures/count', z.object({ data: CaptureCount })),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}
export type CaptureScope = 'mine' | 'all';
// The inbox; the page hands in what the server already read, so the first paint needs no request.
export function useCaptures(
  scope: CaptureScope = 'mine',
  initialData?: z.infer<typeof CaptureList>,
) {
  return useQuery({
    queryKey: [...captureKeys.list, scope],
    queryFn: () => request(scope === 'all' ? '/captures?scope=all' : '/captures', CaptureList),
    ...(initialData ? { initialData } : {}),
    refetchInterval: (query) =>
      query.state.data?.data.some((item) => working.has(item.status)) ? 5_000 : 60_000,
  });
}
function useCaptureMutation<I>(send: (input: I) => Promise<z.infer<typeof one>>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSettled: () => client.invalidateQueries({ queryKey: captureKeys.all }),
  });
}
export function useCreateCapture() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => upload('/captures', one, form),
    onSuccess: (created) => client.setQueryData(captureKeys.detail(created.data.id), created),
    onSettled: () => client.invalidateQueries({ queryKey: captureKeys.count }),
  });
}
export function useRetryCapture() {
  return useCaptureMutation((capture: { id: string; transcript: string | null }) =>
    request(`/captures/${capture.id}/${capture.transcript ? 'interpret' : 'transcribe'}`, one, {
      method: 'POST',
      body: {},
    }),
  );
}

const suggestion = z.object({ data: Suggestion });
const approval = z.object({ data: Approval });
const approvals = z.object({ data: z.object({ approved: z.array(Approval) }) });
const undone = z.object({ data: z.array(Suggestion) });
type Draft = Pick<Suggestion, 'id' | 'revision'>;
type Body = z.infer<ReturnType<typeof z.json>>;
// Every review action refreshes the inbox and the badge; one that creates or removes a live record
// refreshes the tasks and notes that show it too.
function useSend() {
  const client = useQueryClient();
  return async <S extends z.ZodType>(
    path: string,
    schema: S,
    body: Body,
    method = 'POST',
    live = false,
  ) => {
    try {
      return await request(path, schema, { method, body });
    } finally {
      const keys = [captureKeys.all, ...(live ? [['tasks'], ['notes'], ['home']] : [])];
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
    }
  };
}
// CAPTURES-B10 CAPTURES-B11: the review actions.
export function useReviewMutations() {
  const send = useSend();
  const at = (draft: Draft, action = '') => `/captures/suggestions/${draft.id}${action}`;
  return {
    patch: (draft: Draft, change: { kind?: SuggestionKind; payload?: PayloadFields }) =>
      send(at(draft), suggestion, { revision: draft.revision, ...change }, 'PATCH'),
    approve: (draft: Draft) =>
      send(at(draft, '/approve'), approval, { revision: draft.revision }, 'POST', true),
    approveReady: (ids: string[]) =>
      send('/captures/suggestions/approve-ready', approvals, { ids }, 'POST', true),
    discard: (draft: Draft) =>
      send(at(draft, '/discard'), suggestion, { revision: draft.revision }),
    // One draft, or an Approve N ready batch undone whole (§9 decision 10).
    undo: (ids: string[]) => send('/captures/suggestions/undo', undone, { ids }, 'POST', true),
    merge: (captureId: string, keepId: string, mergeIds: string[]) =>
      send(`/captures/${captureId}/merge`, suggestion, { keepId, mergeIds }),
    typeTranscript: (captureId: string, transcript: string) =>
      send(`/captures/${captureId}/transcript`, one, { transcript }),
    // S17: the recording and its drafts leave Review; the delete's op id is what Undo sends back.
    removeCapture: (captureId: string) =>
      send(`/captures/${captureId}`, z.object({ opId: z.uuid() }), {}, 'DELETE'),
    restoreCapture: (captureId: string, opId: string) =>
      send(`/captures/${captureId}/restore`, one, { opId }),
  };
}
// The people a task draft may be given to; the same key as the notes' people list, so one read
// serves both.
export function useAssignablePeople() {
  const query = useQuery({
    queryKey: ['people', 'all'],
    queryFn: () => request('/people?view=all&limit=200', PersonList),
  });
  return (query.data?.data ?? []).filter((person) => person.isAssignable);
}
