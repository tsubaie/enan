import { expect, it } from 'vitest';
import { AppError } from '@/core/http/errors';
import { audioTypeOf, checkVoiceAudio, voiceAudioLimits, voiceFileName } from '../voice-audio';
const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === 'string' ? [...value].map((char) => char.charCodeAt(0)) : [value],
    ),
  );
const pad = (head: Uint8Array) => new Uint8Array([...head, ...new Array(32).fill(0)]);
// NOTES-B29: the first bytes decide, never the name or the declared type.
it('NOTES-B29 recognises WebM, MP4/M4A, MP3, WAV and Ogg by their first bytes', () => {
  expect(audioTypeOf(pad(bytes(0x1a, 0x45, 0xdf, 0xa3)))).toBe('audio/webm');
  expect(audioTypeOf(pad(bytes(0, 0, 0, 0x20, 'ftypM4A ')))).toBe('audio/mp4');
  expect(audioTypeOf(pad(bytes(0, 0, 0, 0x1c, 'ftypiso5')))).toBe('audio/mp4');
  expect(audioTypeOf(pad(bytes('ID3', 4, 0)))).toBe('audio/mpeg');
  expect(audioTypeOf(pad(bytes(0xff, 0xfb, 0x90, 0x44)))).toBe('audio/mpeg');
  expect(audioTypeOf(pad(bytes(0xff, 0xf3, 0x90, 0x44)))).toBe('audio/mpeg');
  expect(audioTypeOf(pad(bytes('RIFF', 0, 0, 0, 0, 'WAVE')))).toBe('audio/wav');
  expect(audioTypeOf(pad(bytes('OggS', 0)))).toBe('audio/ogg');
});
it('NOTES-B29 refuses pages, scripts, programs, pictures and empty files whatever they are called', () => {
  const refused = [
    bytes('<!DOCTYPE html><script>alert(1)</script>'),
    bytes('MZ', 0x90, 0, 3, 0),
    bytes(0x7f, 'ELF', 2, 1),
    bytes('#!/bin/sh\necho'),
    bytes('plain words, not sound'),
    bytes('RIFF', 0, 0, 0, 0, 'WEBP'),
    pad(bytes(0, 0, 0, 0x18, 'ftypheic')),
    bytes(0xff, 0xd8, 0xff, 0xe0),
    new Uint8Array(),
  ];
  for (const file of refused) expect(audioTypeOf(file)).toBeNull();
  expect(() => checkVoiceAudio(bytes('<html>'), 'memo.mp3')).toThrow(
    expect.objectContaining({ code: 'rule_violation', details: { reason: 'unsupported_type' } }),
  );
});
it('NOTES-I08 refuses audio over 25 MB before reading its type', () => {
  const big = new Uint8Array(voiceAudioLimits.maxBytes + 1);
  big.set([0x1a, 0x45, 0xdf, 0xa3]);
  const error = (() => {
    try {
      checkVoiceAudio(big, 'long.webm');
    } catch (caught) {
      return caught;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ details: { reason: 'too_large', maxBytes: 25 * 1024 * 1024 } });
});
it('NOTES-B29 the stored key is the content hash and the name follows the real type', () => {
  const audio = checkVoiceAudio(pad(bytes('OggS', 0)), '../../etc/"board"\u0007;memo.mp3');
  expect(audio.storageKey).toMatch(/^voice-[0-9a-f]{64}$/u);
  expect(audio.storageKey).toBe(`voice-${audio.sha256}`);
  expect(audio.mime).toBe('audio/ogg');
  expect(audio.originalName).toBe('boardmemo.ogg');
  expect(voiceFileName('', 'audio/mp4')).toBe('Voice memo.m4a');
  expect(voiceFileName(`${'a'.repeat(300)}.wav`, 'audio/wav')).toHaveLength(160);
});
