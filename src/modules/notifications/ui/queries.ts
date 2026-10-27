import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { NotificationFeed, type NotificationFilter } from '../schema/validation';
export const feedKey = ['notifications', 'list'];
// NOTIF-B11: the same cadence every list uses (05) — on focus and every sixty seconds while
// visible. There is no socket and no push; the centre is read when the reader opens it.
// The bell asks for its preview of ten (NOTIF-B15); the page passes its own filtered path. Both
// sit under one key prefix, so one write refreshes both.
export function useNotifications(path = '/notifications?limit=10') {
  return useQuery({
    queryKey: [...feedKey, path],
    queryFn: () => request(path, NotificationFeed),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}
function useFeedMutation<I, O>(send: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSettled: () => client.invalidateQueries({ queryKey: feedKey }),
  });
}
export function useMarkRead() {
  return useFeedMutation((id: string) =>
    request(`/notifications/${id}/read`, z.object({ data: z.object({ id: z.uuid() }) }), {
      method: 'POST',
      body: {},
    }),
  );
}
// NOTIF-B07: the bell marks everything; the page passes the kind it is filtered to.
export function useMarkAllRead() {
  return useFeedMutation((kind?: NotificationFilter) =>
    request('/notifications/read-all', z.object({ data: z.object({ marked: z.number() }) }), {
      method: 'POST',
      body: kind ? { kind } : {},
    }),
  );
}
