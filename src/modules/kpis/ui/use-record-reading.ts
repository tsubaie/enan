'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
// KPIS-B30: `action=recordReading` on the record's URL is how a reading-due notification asks for
// the reading dialog. Once the dialog closes the request is spent, so it leaves the URL with it.
export function useRecordReadingAction() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return {
    requested: params.get('action') === 'recordReading',
    clear: () => {
      const next = new URLSearchParams(params);
      next.delete('action');
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
  };
}
