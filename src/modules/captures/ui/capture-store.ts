'use client';
import { useSyncExternalStore } from 'react';
// The recorder is started from more than one place (the phone button, the header control, the
// Alt/Option+V chord) and lives once, in the shell. The shell registers how to start it; a control
// calls `startCapture` inside its own click or key event, so the browser sees the microphone asked
// for by a gesture (Safari refuses it otherwise). `active` lets the header show a recording.
type State = { launch: (() => void) | null; active: boolean };
let state: State = { launch: null, active: false };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function startCapture() {
  state.launch?.();
}
export function registerCapture(launch: (() => void) | null) {
  set({ launch });
}
export function setCaptureActive(active: boolean) {
  if (state.active !== active) set({ active });
}
const initial: State = { launch: null, active: false };
export function useCaptureActive() {
  return useSyncExternalStore(
    subscribe,
    () => state.active,
    () => initial.active,
  );
}
