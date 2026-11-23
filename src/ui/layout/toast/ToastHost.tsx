'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { cn } from '@/ui/cn';
import { Button, buttonVariants } from '@/ui/primitives/button';
import {
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from '@/ui/primitives/toast';

// Eight seconds is long enough to read one sentence and reach the action beside it. The primitive
// holds the timer while the viewport is hovered or focused, so a reader who is looking at the
// toast never loses it mid-reach, and Trash is the recovery path that outlives it either way.
const TOAST_TIMEOUT = 8000;
// Two at once, app-wide, each independently undoable: a newer toast never takes an older one's
// action away. The primitive keeps a third mounted but hidden (`data-limited`) rather than dropping
// it, so a toast that stays until it is answered (a held recording, CAPTURES-B20) comes back as
// soon as a newer one closes. Collapsed they peek over one another and cost about one row of
// height; the stack opens out while the viewport is hovered or focused.
const TOAST_LIMIT = 2;

export function ToastHost({ children }: { children: ReactNode }) {
  return (
    <ToastProvider timeout={TOAST_TIMEOUT} limit={TOAST_LIMIT}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

// What a toast may carry besides its title, description and action:
// `view`, a link that follows the action (S26: Undo and View; How it works);
// `secondary`, a quieter button before the action (Discard before Retry);
// `tone: 'warning'`, the warning-soft ground for a notice that something is not as asked;
// `progress`, the label of an indeterminate bar for work under way (the upload cannot say how far
// it is, CAPTURES-B20).
const ToastData = z
  .object({
    view: z.object({ href: z.string(), label: z.string() }),
    secondary: z.object({
      label: z.string(),
      onClick: z.custom<() => void>((value) => typeof value === 'function'),
    }),
    tone: z.literal('warning'),
    progress: z.string(),
  })
  .partial()
  .catch({});
// One row and one way out: the action when the toast carries one, a dismiss when it does not. Undo
// and a close button side by side are two small neighbours, and the slip that costs the reader
// their only way back is the one that lands on the wrong one. A notice with nothing to do about it
// gets the dismiss instead, which is also what a failed undo turns into. A toast with a secondary
// choice is answered by one of its two buttons, and one with work under way is not dismissed.
function ToastList() {
  const { toasts } = useToastManager();
  return toasts.map((toast) => {
    const data = ToastData.parse(toast.data);
    // A toast with a second line or two answers gives its words the whole width and puts its
    // controls on a row of their own at the end, so a phone never squeezes the sentence.
    const wide = Boolean(toast.description || data.secondary);
    return (
      <ToastRoot key={toast.id} toast={toast} data-tone={data.tone}>
        <ToastContent className={wide ? 'flex-wrap' : undefined}>
          <span className={cn('grid min-w-0 flex-1 gap-1 py-1.5', wide && 'basis-full')}>
            <ToastTitle />
            {toast.description ? <ToastDescription className="whitespace-pre-line" /> : null}
            {data.progress ? (
              <span role="progressbar" aria-label={data.progress} data-slot="toast-progress" />
            ) : null}
          </span>
          <ToastControls data={data} action={Boolean(toast.actionProps?.children)} />
        </ToastContent>
      </ToastRoot>
    );
  });
}
const touch = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';
function ToastControls({ data, action }: { data: z.infer<typeof ToastData>; action: boolean }) {
  const { view, secondary, progress } = data;
  return (
    <span className="ms-auto flex items-center gap-3">
      {secondary ? (
        <Button variant="ghost" className={touch} onClick={secondary.onClick}>
          {secondary.label}
        </Button>
      ) : null}
      {action ? <ToastAction /> : null}
      {view ? (
        <Link href={view.href} className={buttonVariants({ variant: 'ghost', className: touch })}>
          {view.label}
        </Link>
      ) : null}
      {action || secondary || progress ? null : <ToastClose />}
    </span>
  );
}
