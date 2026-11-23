'use client';
import { useEffect, type ReactNode } from 'react';
// The recorder's two frames: full screen on a phone, a floating card on a desktop.
export type Placement = 'mobile-fullscreen' | 'desktop-floating';
// CAPTURES-B01: on a phone the recorder is a modal dialog, and the page, the bar and the skip link
// into the page are inert (out of the tab order and the accessibility tree) until it closes or
// unmounts. The desktop card is not modal and leaves the page live.
export function CaptureModal({
  placement,
  label,
  children,
}: {
  placement: Placement;
  label: string;
  children: ReactNode;
}) {
  const modal = placement === 'mobile-fullscreen';
  // sync: external system — the shell's DOM outside this component.
  useEffect(() => {
    if (!modal) return;
    const behind = document.querySelectorAll<HTMLElement>(
      '.app-canvas, nav.mobile-navigation, a[href="#content"]',
    );
    for (const node of behind) node.toggleAttribute('inert', true);
    return () => {
      for (const node of behind) node.removeAttribute('inert');
    };
  }, [modal]);
  return modal ? (
    <div role="dialog" aria-modal aria-label={label}>
      {children}
    </div>
  ) : (
    children
  );
}
