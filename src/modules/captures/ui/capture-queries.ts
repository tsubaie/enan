'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request, upload } from '@/core/http/client';
import { CaptureCount, CaptureGroup, CaptureList } from '../schema/validation';
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
export function useCaptures() {
  return useQuery({
    queryKey: captureKeys.list,
    queryFn: () => request('/captures', CaptureList),
    refetchInterval: (query) =>
      query.state.data?.data.some((item) => working.has(item.status)) ? 5_000 : 60_000,
  });
}
// S11: the capture just recorded, read every few seconds while its jobs run; once it settles the
// badge and the list are refreshed with it.
export function useCapture(captureId: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: captureKeys.detail(captureId ?? ''),
    enabled: Boolean(captureId),
    queryFn: async () => {
      const result = await request(`/captures/${captureId}`, one);
      if (!working.has(result.data.status))
        void client.invalidateQueries({ queryKey: captureKeys.count });
      return result;
    },
    refetchInterval: (query) =>
      query.state.data && !working.has(query.state.data.data.status) ? false : 3_000,
  });
}
function useCaptureMutation<I>(
  send: (input: I) => Promise<z.infer<typeof one> | { opId: string }>,
) {
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
export function useRemoveCapture() {
  return useCaptureMutation((captureId: string) =>
    request(`/captures/${captureId}`, z.object({ opId: z.uuid() }), { method: 'DELETE' }),
  );
}
