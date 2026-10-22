'use client';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { useCount } from '@/ui/format';
import { CountCircle } from '@/ui/primitives/count-circle';
const Counts = z.object({ meta: z.object({ counts: z.record(z.string(), z.number()) }) });
// The side menu shows KPIs only when some are off target: a red circle with how many, and nothing
// otherwise. It asks for one row and reads `meta.counts` under the module's key, so any KPI
// mutation refreshes it.
export function KpiCountBadge() {
  const format = useCount();
  const query = useQuery({
    queryKey: ['kpis', 'counts', {}],
    queryFn: () => request('/kpis?view=all&limit=1', Counts),
    refetchInterval: 60000,
  });
  const red = query.data?.meta.counts.off_target;
  if (!red) return null;
  return <CountCircle danger>{format(red)}</CountCircle>;
}
