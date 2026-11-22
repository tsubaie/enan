import { expect, it } from 'vitest';
import {
  mp3Audio,
  mp4Audio,
  oggAudio,
  wavAudio,
  webmAudio,
} from '../../../../tests/fixtures/audio';
import { audioDurationSeconds } from '../audio-duration';
import { checkVoiceAudio, voiceAudioLimits } from '../voice-audio';
// CAPTURES-B12: the length comes from the container's header, in every format an upload may be.
it('CAPTURES-B12 reads a WebM length from its Segment Info, or from its last Cluster while it is still open', () => {
  expect(audioDurationSeconds(webmAudio({ durationMs: 61_500 }), 'audio/webm')).toBe(61.5);
  expect(
    audioDurationSeconds(webmAudio({ clusterMs: 1_200_000, blockMs: 5_000 }), 'audio/webm'),
  ).toBe(1205);
});
it('CAPTURES-B12 reads an M4A length from its movie header, version 0 and 1', () => {
  expect(audioDurationSeconds(mp4Audio(1000, 125_000), 'audio/mp4')).toBe(125);
  expect(audioDurationSeconds(mp4Audio(44100, 44100 * 1800, 1), 'audio/mp4')).toBe(1800);
});
it('CAPTURES-B12 reads an Ogg length from its last granule, at 48 kHz for Opus and the Vorbis rate', () => {
  expect(audioDurationSeconds(oggAudio(600), 'audio/ogg')).toBe(600);
  expect(audioDurationSeconds(oggAudio(90, { vorbis: 22050 }), 'audio/ogg')).toBe(90);
});
it('CAPTURES-B12 reads a WAV length from its data over its byte rate, counting only bytes it holds', () => {
  expect(audioDurationSeconds(wavAudio(8000, 8000 * 12), 'audio/wav')).toBe(12);
  expect(audioDurationSeconds(wavAudio(8000, 8000 * 3, 8000 * 900), 'audio/wav')).toBe(3);
});
it('CAPTURES-B12 reads an MP3 length from its Xing frame count, or its bitrate when constant', () => {
  expect(audioDurationSeconds(mp3Audio({ frames: 38_281 }), 'audio/mpeg')).toBeCloseTo(1000, 0);
  expect(audioDurationSeconds(mp3Audio({ bytes: 16_000 * 30 }), 'audio/mpeg')).toBe(30);
});
it('CAPTURES-B12 a header that is cut short or says nothing gives no length, and does not throw', () => {
  for (const [bytes, mime] of [
    [webmAudio({ durationMs: 1000 }).subarray(0, 12), 'audio/webm'],
    [mp4Audio(1000, 5000).subarray(0, 30), 'audio/mp4'],
    [oggAudio(10).subarray(0, 20), 'audio/ogg'],
    [wavAudio(8000, 0).subarray(0, 20), 'audio/wav'],
    [new Uint8Array([0xff, 0xfb]), 'audio/mpeg'],
  ] as const)
    expect(audioDurationSeconds(bytes, mime)).toBeNull();
});
it('CAPTURES-B12 audio its header proves longer than 15 minutes is refused, whatever was declared', () => {
  for (const bytes of [
    webmAudio({ clusterMs: 901_000, blockMs: 0 }),
    mp4Audio(1000, 901_000),
    oggAudio(1200),
    mp3Audio({ frames: 40_000 }),
  ])
    expect(() => checkVoiceAudio(bytes, 'long')).toThrow(
      expect.objectContaining({
        code: 'rule_violation',
        details: { reason: 'too_long', maxSeconds: 900 },
      }),
    );
  expect(checkVoiceAudio(oggAudio(900), 'full').durationSeconds).toBe(900);
});
it('CAPTURES-B12 a length the header does not give is estimated from the size, never above the cap', () => {
  const junk = (size: number) => {
    const bytes = new Uint8Array(size).fill(7);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
    return bytes;
  };
  expect(checkVoiceAudio(junk(1_000_000), 'open').durationSeconds).toBe(500);
  expect(checkVoiceAudio(junk(voiceAudioLimits.maxBytes), 'open').durationSeconds).toBe(900);
});
// CAPTURES-B12 (F2): 25 MB of tiny elements, boxes, chunks or marker bytes is parsed on the shared
// event loop. The bound is generous so a busy test runner does not flake; unbounded, these took
// over 700 ms and up to a gigabyte of heap.
it('CAPTURES-B12 a 25 MB header of tiny parts gives up within a bounded time and memory', () => {
  const size = voiceAudioLimits.maxBytes;
  const repeat = (head: number[], unit: number[]) => {
    const bytes = new Uint8Array(size);
    for (let at = head.length; at + unit.length <= size; at += unit.length) bytes.set(unit, at);
    bytes.set(head);
    return bytes;
  };
  const ebml = [0x1a, 0x45, 0xdf, 0xa3];
  for (const [name, bytes, mime] of [
    ['webm of 2-byte elements', repeat(ebml, [0x81, 0x80]), 'audio/webm'],
    ['mp4 of free boxes', repeat([], [0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]), 'audio/mp4'],
    [
      'wav of empty junk chunks',
      repeat(
        [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
        [0x6a, 0x75, 0x6e, 0x6b, 0, 0, 0, 0],
      ),
      'audio/wav',
    ],
    [
      'webm of Cluster ids with no Timecode',
      repeat([...ebml, 0x80, 0x18, 0x53, 0x80, 0x67, 0x80], [0x1f, 0x43, 0xb6, 0x75]),
      'audio/webm',
    ],
    ['webm of 0x1f bytes', new Uint8Array(size).fill(0x1f), 'audio/webm'],
    [
      'ogg of pages with no granule',
      repeat(
        [
          0x4f,
          0x67,
          0x67,
          0x53,
          ...new Array<number>(23).fill(0),
          ...[...'OpusHead'].map((c) => c.charCodeAt(0)),
        ],
        [0x4f, 0x67, 0x67, 0x53, ...new Array<number>(10).fill(0)],
      ),
      'audio/ogg',
    ],
    ['mp3 with no frame sync', new Uint8Array(size), 'audio/mpeg'],
  ] as const) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const seconds = audioDurationSeconds(bytes, mime);
    const elapsed = performance.now() - started;
    expect({ name, seconds }).toEqual({ name, seconds: null });
    expect(elapsed, name).toBeLessThan(250);
    expect(process.memoryUsage().heapUsed - heap, name).toBeLessThan(16 * 1024 * 1024);
  }
});
