import { queryOptions, usePrefetchQuery, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { Home } from '../schema/validation';
const home = queryOptions({
  queryKey: ['home'],
  queryFn: () => request('/home', z.object({ data: Home })),
});
export function useHome() {
  // Started while the page renders, not when it mounts: a page change runs its view transition
  // (ADR 0019) before effects, and a fetch begun in an effect waits for it (ExecutiveOS#79).
  usePrefetchQuery(home);
  return useQuery(home);
}
