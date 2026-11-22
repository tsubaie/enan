'use client';
import dynamic from 'next/dynamic';
export const PersonNotes = dynamic(() =>
  import('./PersonNotes').then((module) => module.PersonNotes),
);
export const CommitteeNotes = dynamic(() =>
  import('./CommitteeNotes').then((module) => module.CommitteeNotes),
);
export const NoteTypesAdmin = dynamic(() =>
  import('./NoteTypesAdmin').then((module) => module.NoteTypesAdmin),
);
export const NoteTemplatesAdmin = dynamic(() =>
  import('./NoteTemplatesAdmin').then((module) => module.NoteTemplatesAdmin),
);
export const TagsAdmin = dynamic(() => import('./TagsAdmin').then((module) => module.TagsAdmin));
// CAPTURES-B01: the voice capture recorder reuses the memo recorder, its meter and its clock in
// place rather than a copy of them.
export { useVoiceRecorder, recorderLimits, type Recording } from './use-voice-recorder';
export { RecorderMeter, recorderKeys, recordingFile } from './VoiceCapture';
export { clock } from './VoiceMemoPlayer';
