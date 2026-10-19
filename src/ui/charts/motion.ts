'use client';
import { useSyncExternalStore } from 'react';
// KPIS-B29: a chart fills in when it first appears, the gauge sweeping round to its value and the
// columns rising from the baseline, so the eye lands on the answer as it arrives. The same marks
// stand still for a reader who has asked the system for less motion. The server has no such
// preference to read, so it renders the still version and the client takes over.
const query = '(prefers-reduced-motion: reduce)';
function subscribe(change: () => void) {
  const media = matchMedia(query);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
type ChartMotion = {
  active: boolean;
  easing: 'ease-out';
  gauge: number;
  bars: number;
  line: { begin: number; duration: number };
};
export function useChartMotion(): ChartMotion {
  const reduced = useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => true,
  );
  return {
    active: !reduced,
    easing: 'ease-out',
    // The gauge is one mark and gets the longer sweep; the columns rise together, and the target
    // line is drawn once they stand, so it reads as the measure laid over them.
    gauge: 1000,
    bars: 800,
    line: { begin: 500, duration: 600 },
  };
}
