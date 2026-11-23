import type { ReactNode } from 'react';
import type { CaptureSetup } from '../schema/validation';
import { CaptureEntry } from './CaptureEntry';
export type CaptureEntries = Record<'floating' | 'more' | 'moreDot' | 'header' | 'menu', ReactNode>;
// CAPTURES-B17 CAPTURES-B18: which slot of the shell gets which way to record, from the placement
// the server resolved (CAPTURES-B16). A phone always has exactly one (the circle, or the More
// action with its dot); a computer has the header button, the account-menu action, or neither
// (Alt+V and the inbox Record). With recording off there is none (CAPTURES-B14).
// CAPTURES-B18: the inbox header's Record whenever recording is on, naming Alt+V beside it when
// the computer has no other visible way to record and the shortcut is on.
export function inboxEntry(setup: CaptureSetup) {
  if (!setup.enabled) return null;
  return (
    <CaptureEntry.Inbox hint={setup.desktop === 'hidden' && setup.shortcut ? 'shortcut' : null} />
  );
}
export function captureEntries(setup: CaptureSetup): CaptureEntries {
  if (!setup.enabled)
    return { floating: null, more: null, moreDot: null, header: null, menu: null };
  const keys = setup.shortcut ? 'Alt+V' : null;
  const more = setup.mobile === 'more';
  return {
    floating: more ? null : (
      <CaptureEntry.Floating side={setup.mobile === 'floating-start' ? 'start' : 'end'} />
    ),
    more: more ? <CaptureEntry.MoreAction /> : null,
    moreDot: more ? <CaptureEntry.MoreDot /> : null,
    header: setup.desktop === 'header' ? <CaptureEntry.Header keys={keys} /> : null,
    menu: setup.desktop === 'account-menu' ? <CaptureEntry.MenuAction keys={keys} /> : null,
  };
}
