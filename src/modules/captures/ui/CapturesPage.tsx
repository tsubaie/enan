'use client';
import type { CaptureList } from '../schema/validation';
import type { z } from 'zod';
import type { CaptureScope } from './capture-queries';
import { CaptureInbox } from './CaptureInbox';
import { useWideScreen } from './inbox-state';
// S14 as a page: inline drafts on a desktop, compact cards on a phone. The server read the first
// page of the inbox, so it paints without a request of its own.
export function CapturesPage({
  initial,
  scope,
  admin,
}: {
  initial: z.infer<typeof CaptureList>;
  scope: CaptureScope;
  admin: boolean;
}) {
  const layout = useWideScreen() ? 'panel' : 'compact';
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4 lg:p-6">
      <CaptureInbox.Root layout={layout} scope={scope} initial={initial}>
        <CaptureInbox.Education />
        {admin && <CaptureInbox.Scope />}
        <CaptureInbox.Groups />
        <CaptureInbox.Empty />
      </CaptureInbox.Root>
    </div>
  );
}
