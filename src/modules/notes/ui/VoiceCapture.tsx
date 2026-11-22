'use client';
import { type KeyboardEvent } from 'react';
import { recorderLimits, type Recording, type useVoiceRecorder } from './use-voice-recorder';
type Recorder = ReturnType<typeof useVoiceRecorder>;
const barIds = Array.from({ length: recorderLimits.bars }, (_, index) => index);
export const recordingFile = (recording: Recording, name: string) =>
  new File([recording.blob], `${name}.${recording.extension}`, { type: recording.blob.type });
// Keys act on the bar itself, so a focused button still behaves as a button: Space pauses or
// resumes, Enter stops and attaches; Escape cancels, or does what `escape` says, from anywhere inside.
export function recorderKeys(recorder: Recorder, escape: () => void = recorder.cancel) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    const own = event.target === event.currentTarget;
    const actions: Record<string, (() => void) | null> = {
      Escape: escape,
      ' ': own ? recorder.toggle : null,
      Enter: own ? recorder.stop : null,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
}
// Each bar registers its element; the recorder's frame loop scales it without a render.
export function RecorderMeter({ bars }: { bars: Recorder['bars'] }) {
  return (
    <div aria-hidden data-testid="voice-meter" className="flex h-8 items-center gap-0.5">
      {barIds.map((bar) => (
        <span
          key={bar}
          ref={(node) => {
            bars.current[bar] = node;
          }}
          className="h-full w-1 origin-center scale-y-[0.08] rounded-full bg-danger transition-transform duration-75"
        />
      ))}
    </div>
  );
}
