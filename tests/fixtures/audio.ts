// Tiny audio containers built byte by byte, each holding only the header fields its length is
// read from, so a test names the length it means without a binary file in the repository.
const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));
const be = (value: number, length: number) =>
  Array.from({ length }, (_, index) => Math.floor(value / 256 ** (length - 1 - index)) % 256);
const le = (value: number, length: number) => be(value, length).reverse();
const join = (...parts: (number[] | Uint8Array)[]) =>
  new Uint8Array(parts.flatMap((part) => [...part]));

const unknownSize = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const float64 = (value: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return [...new Uint8Array(view.buffer)];
};
// WebM with a Segment Info Duration (milliseconds at the default scale), or a recording still
// being written: no Duration, one open Cluster at `clusterMs` whose last block is `blockMs` on.
export function webmAudio(length: { durationMs: number } | { clusterMs: number; blockMs: number }) {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x80];
  const segment = [0x18, 0x53, 0x80, 0x67, ...unknownSize];
  const scale = [0x2a, 0xd7, 0xb1, 0x83, ...be(1_000_000, 3)];
  if ('durationMs' in length) {
    const duration = [0x44, 0x89, 0x88, ...float64(length.durationMs)];
    return join(
      ebml,
      segment,
      [0x15, 0x49, 0xa9, 0x66, 0x80 + scale.length + duration.length],
      scale,
      duration,
    );
  }
  const block = (at: number) => [0xa3, 0x84, 0x81, ...be(at, 2), 0x80];
  return join(
    ebml,
    segment,
    [0x15, 0x49, 0xa9, 0x66, 0x80 + scale.length],
    scale,
    [0x1f, 0x43, 0xb6, 0x75, ...unknownSize, 0xe7, 0x84, ...be(length.clusterMs, 4)],
    block(0),
    block(length.blockMs),
  );
}
// M4A whose movie header (version 0 or 1) gives `duration` at `timescale`.
export function mp4Audio(timescale: number, duration: number, version: 0 | 1 = 0) {
  const fields =
    version === 0
      ? [0, 0, 0, 0, ...be(0, 4), ...be(0, 4), ...be(timescale, 4), ...be(duration, 4)]
      : [1, 0, 0, 0, ...be(0, 8), ...be(0, 8), ...be(timescale, 4), ...be(duration, 8)];
  const mvhd = [
    ...be(8 + fields.length + 80, 4),
    ...ascii('mvhd'),
    ...fields,
    ...new Array(80).fill(0),
  ];
  return join(
    [...be(16, 4), ...ascii('ftypM4A '), ...be(0, 4)],
    [...be(8 + mvhd.length, 4), ...ascii('moov')],
    mvhd,
  );
}
const oggPage = (granule: number, payload: number[]) => [
  ...ascii('OggS'),
  0,
  0,
  ...le(granule, 8),
  ...be(1, 4),
  ...be(0, 4),
  ...be(0, 4),
  1,
  payload.length,
  ...payload,
];
// Ogg Opus (48 kHz granules) or Vorbis at `rate`, whose last page ends at `seconds`.
export function oggAudio(seconds: number, codec: 'opus' | { vorbis: number } = 'opus') {
  const rate = codec === 'opus' ? 48000 : codec.vorbis;
  const head =
    codec === 'opus'
      ? [...ascii('OpusHead'), 1, 1, ...new Array(9).fill(0)]
      : [1, ...ascii('vorbis'), ...be(0, 4), 1, ...le(rate, 4), ...new Array(16).fill(0)];
  return join(oggPage(0, head), oggPage(seconds * rate, [0, 0, 0, 0]));
}
// PCM WAV at `byteRate` with `dataBytes` of sound; the data chunk may claim more than it holds.
export function wavAudio(byteRate: number, dataBytes: number, claimed = dataBytes) {
  const format = [
    ...le(1, 2),
    ...le(1, 2),
    ...le(byteRate, 4),
    ...le(byteRate, 4),
    ...le(1, 2),
    ...le(8, 2),
  ];
  return join(
    [...ascii('RIFF'), ...le(36 + dataBytes, 4), ...ascii('WAVE')],
    [...ascii('fmt '), ...le(16, 4), ...format],
    [...ascii('data'), ...le(claimed, 4)],
    new Uint8Array(dataBytes),
  );
}
// MPEG-1 Layer III, 128 kbps, 44.1 kHz stereo: a Xing header counting `frames`, or plain CBR
// frames filling `bytes`.
export function mp3Audio(length: { frames: number } | { bytes: number }) {
  const header = [0xff, 0xfb, 0x90, 0x00];
  if ('frames' in length)
    return join(
      header,
      new Array(32).fill(0),
      ascii('Xing'),
      be(1, 4),
      be(length.frames, 4),
      new Array(400).fill(0),
    );
  return join(header, new Uint8Array(length.bytes - header.length));
}
