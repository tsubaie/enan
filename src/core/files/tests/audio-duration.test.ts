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
