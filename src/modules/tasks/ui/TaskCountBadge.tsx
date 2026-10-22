'use client';
import { useCount } from '@/ui/format';
import { CountCircle } from '@/ui/primitives/count-circle';
import { useTaskCount } from './queries';
// TASKS-B17: how much is open, without opening the module. Zero is not worth a chip, and neither
// is a placeholder while the figure loads, so both render nothing.
export function TaskCountBadge() {
  const format = useCount();
  const open = useTaskCount();
  if (!open) return null;
  return <CountCircle key={open}>{format(open)}</CountCircle>;
}
