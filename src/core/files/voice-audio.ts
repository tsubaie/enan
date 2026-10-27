import 'server-only';
import { createHash } from 'node:crypto';
import { AppError } from '@/core/http/errors';
// NOTES-I08: a voice memo is at most 25 MB and 15 minutes, and a note holds at most 20.
export const voiceAudioLimits = {
  maxBytes: 25 * 1024 * 1024,
  maxDurationSeconds: 900,
  maxPerNote: 20,
};
export type VoiceAudioMime = 'audio/webm' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
const extensions: Record<VoiceAudioMime, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};
const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));
// An ISO media file whose brand names a still image (HEIC, AVIF) is a picture, not a recording.
const imageBrands = new Set(['heic', 'heix', 'mif1', 'msf1', 'avif', 'avis']);
const mpegFrame = (bytes: Uint8Array) => bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
const signatures: [VoiceAudioMime, (bytes: Uint8Array) => boolean][] = [
  [
    'audio/webm',
    (bytes) => bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
  ],
  ['audio/mp4', (bytes) => ascii(bytes, 4, 4) === 'ftyp' && !imageBrands.has(ascii(bytes, 8, 4))],
  ['audio/mpeg', (bytes) => ascii(bytes, 0, 3) === 'ID3' || mpegFrame(bytes)],
  ['audio/wav', (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE'],
  ['audio/ogg', (bytes) => ascii(bytes, 0, 4) === 'OggS'],
];
// NOTES-B29: the type is read from the first bytes, never from the name or the type the browser
// declared, so a renamed page, script or program cannot pass for a recording.
export function audioTypeOf(bytes: Uint8Array): VoiceAudioMime | null {
  if (bytes.length < 4) return null;
  return signatures.find(([, matches]) => matches(bytes))?.[0] ?? null;
}
// The name is a label only, never part of a path: its folder, control characters and quotes go
// (it travels in a Content-Disposition header), and its extension follows the real type.
export function voiceFileName(fileName: string, mime: VoiceAudioMime) {
  const base = (fileName.split(/[\\/]/u).pop() ?? '')
    .replace(/\.[^.]+$/u, '')
    .replace(/[\p{Cc}"';]/gu, '')
    .trim();
  const extension = `.${extensions[mime]}`;
  return `${(base || 'Voice memo').slice(0, 160 - extension.length)}${extension}`;
}
// Checked by size, then by its first bytes; the storage key is the content's hash, so the same
// recording uploaded twice is one binary.
export function checkVoiceAudio(bytes: Uint8Array, fileName: string) {
  if (bytes.byteLength > voiceAudioLimits.maxBytes)
    throw new AppError('rule_violation', {
      reason: 'too_large',
      maxBytes: voiceAudioLimits.maxBytes,
    });
  const mime = audioTypeOf(bytes);
  if (!mime) throw new AppError('rule_violation', { reason: 'unsupported_type' });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    mime,
    sha256,
    storageKey: `voice-${sha256}`,
    originalName: voiceFileName(fileName, mime),
    sizeBytes: bytes.byteLength,
  };
}
