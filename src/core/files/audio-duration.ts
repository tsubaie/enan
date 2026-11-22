import 'server-only';
// F1 CAPTURES-B12: the length is read from the container's own header, never taken from the
// client, with no decoder and no subprocess (ADR 0029). Each reader returns seconds, or null when
// the header does not say.
type Reader = (bytes: Uint8Array, view: DataView) => number | null;
const text = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

// EBML variable-length integer: the leading zero bits give its length. An id keeps its marker
// bit; a size drops it, and a size of all ones is "unknown".
function vint(bytes: Uint8Array, offset: number, keepMarker: boolean) {
  const first = bytes[offset] ?? 0;
  const length = Math.clz32(first) - 23;
  if (length < 1 || length > 8 || offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let ones = value === 0xff >> length;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index] ?? 0;
    value = value * 256 + byte;
    ones &&= byte === 0xff;
  }
  return { value: !keepMarker && ones ? Infinity : value, length };
}
function element(bytes: Uint8Array, offset: number) {
  const id = vint(bytes, offset, true);
  const size = id && vint(bytes, offset + id.length, false);
  if (!id || !size) return null;
  const start = offset + id.length + size.length;
  return { id: id.value, start, end: Math.min(bytes.length, start + size.value) };
}
function* children(bytes: Uint8Array, start: number, end: number) {
  for (let offset = start; offset < end;) {
    const child = element(bytes, offset);
    if (!child) return;
    yield child;
    if (child.end <= offset) return;
    offset = child.end;
  }
}
const uint = (bytes: Uint8Array, start: number, end: number) =>
  bytes.subarray(start, end).reduce((value, byte) => value * 256 + byte, 0);

// WebM: the Segment Info's Duration in TimecodeScale units, or (a recording still being written
// has none) the last Cluster's Timecode plus its latest block.
const webm: Reader = (bytes, view) => {
  const segment = [...children(bytes, 0, bytes.length)].find((item) => item.id === 0x18538067);
  if (!segment) return null;
  let scale = 1_000_000;
  let duration = 0;
  for (const item of children(bytes, segment.start, segment.end)) {
    if (item.id !== 0x1549a966) continue;
    for (const field of children(bytes, item.start, item.end)) {
      if (field.id === 0x2ad7b1) scale = uint(bytes, field.start, field.end);
      if (field.id === 0x4489 && field.end - field.start === 4)
        duration = view.getFloat32(field.start);
      if (field.id === 0x4489 && field.end - field.start === 8)
        duration = view.getFloat64(field.start);
    }
    break;
  }
  return (Math.max(duration, lastCluster(bytes, view)) * scale) / 1e9 || null;
};
// The last place `sequence` starts at or before `from`, or -1.
function find(bytes: Uint8Array, sequence: readonly number[], from: number) {
  const [head = 0] = sequence;
  const next = (at: number) => (at > 0 ? bytes.lastIndexOf(head, at - 1) : -1);
  for (let at = from < 0 ? -1 : bytes.lastIndexOf(head, from); at >= 0; at = next(at))
    if (sequence.every((byte, index) => bytes[at + index] === byte)) return at;
  return -1;
}
const clusterId = [0x1f, 0x43, 0xb6, 0x75];
function lastCluster(bytes: Uint8Array, view: DataView) {
  for (
    let at = find(bytes, clusterId, bytes.length);
    at >= 0;
    at = find(bytes, clusterId, at - 1)
  ) {
    const cluster = element(bytes, at);
    const timecode = cluster && element(bytes, cluster.start);
    if (timecode?.id === 0xe7)
      return uint(bytes, timecode.start, timecode.end) + latestBlock(bytes, view, timecode.end);
  }
  return 0;
}
// A SimpleBlock's timecode, relative to its Cluster, follows its track number.
function latestBlock(bytes: Uint8Array, view: DataView, start: number) {
  let latest = 0;
  for (const block of children(bytes, start, bytes.length)) {
    const track = block.id === 0xa3 ? vint(bytes, block.start, false) : null;
    const at = track ? block.start + track.length : block.end;
    if (at + 2 <= block.end) latest = Math.max(latest, view.getInt16(at));
  }
  return latest;
}

// MP4/M4A: the movie header's duration over its timescale, version 0 (32-bit) or 1 (64-bit).
function* boxes(bytes: Uint8Array, view: DataView, start: number, end: number) {
  for (let offset = start; offset + 8 <= end;) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) [size, header] = [Number(view.getBigUint64(offset + 8)), 16];
    if (size === 0) size = end - offset;
    if (size < header) return;
    yield { type: text(bytes, offset + 4, 4), start: offset + header, end: offset + size };
    offset += size;
  }
}
const mp4: Reader = (bytes, view) => {
  const moov = [...boxes(bytes, view, 0, bytes.length)].find((box) => box.type === 'moov');
  const mvhd =
    moov &&
    [...boxes(bytes, view, moov.start, Math.min(moov.end, bytes.length))].find(
      (box) => box.type === 'mvhd',
    );
  if (!mvhd) return null;
  const v1 = bytes[mvhd.start] === 1;
  const timescale = view.getUint32(mvhd.start + (v1 ? 20 : 12));
  const duration = v1
    ? Number(view.getBigUint64(mvhd.start + 24))
    : view.getUint32(mvhd.start + 16);
  return timescale ? duration / timescale : null;
};

// Ogg: the last page's granule position in samples: 48 kHz for Opus, the identification header's
// rate for Vorbis.
const ogg: Reader = (bytes, view) => {
  const first = 27 + (bytes[26] ?? 0);
  const rate =
    text(bytes, first, 8) === 'OpusHead'
      ? 48000
      : text(bytes, first + 1, 6) === 'vorbis'
        ? view.getUint32(first + 12, true)
        : 0;
  if (!rate) return null;
  const page = [0x4f, 0x67, 0x67, 0x53];
  for (let at = find(bytes, page, bytes.length - 27); at >= 0; at = find(bytes, page, at - 1)) {
    const granule = view.getBigInt64(at + 6, true);
    if (granule > 0n) return Number(granule) / rate;
  }
  return null;
};

// WAV: the data chunk's bytes (as many as the file holds) over the format's byte rate.
const wav: Reader = (bytes, view) => {
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = text(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data')
      return byteRate ? Math.min(size, bytes.length - offset - 8) / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
};

// MP3 (MPEG Layer III): the Xing/Info frame count when the encoder wrote one, otherwise the
// first frame's bitrate over the audio's bytes.
// shortcut: Layer I/II and VBRI headers fall back to the size estimate; add them if they turn up.
const lower = {
  kbps: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  samples: 576,
  side: [17, 9],
};
// By the header's version bits: MPEG-1, MPEG-2 and MPEG-2.5 (1 is reserved).
const versions = new Map([
  [
    3,
    {
      kbps: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
      samples: 1152,
      side: [32, 17],
      divisor: 1,
    },
  ],
  [2, { ...lower, divisor: 2 }],
  [0, { ...lower, divisor: 4 }],
]);
function frameStart(bytes: Uint8Array) {
  let at = 0;
  if (text(bytes, 0, 3) === 'ID3')
    at =
      10 +
      ((bytes[5] ?? 0) & 0x10 ? 10 : 0) +
      bytes.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0);
  while (at + 4 <= bytes.length && !(bytes[at] === 0xff && ((bytes[at + 1] ?? 0) & 0xe0) === 0xe0))
    at += 1;
  return at;
}
function layer3(header: number) {
  const version = versions.get((header >>> 19) & 3);
  const bitrate = version?.kbps[(header >>> 12) & 15] ?? 0;
  const base = [44100, 48000, 32000][(header >>> 10) & 3] ?? 0;
  if (!version || ((header >>> 17) & 3) !== 1 || !bitrate || !base) return null;
  return {
    bitrate,
    rate: base / version.divisor,
    samples: version.samples,
    side: version.side[((header >>> 6) & 3) === 3 ? 1 : 0] ?? 0,
  };
}
const mp3: Reader = (bytes, view) => {
  const at = frameStart(bytes);
  const frame = layer3(view.getUint32(at));
  if (!frame) return null;
  const tag = text(bytes, at + 4 + frame.side, 4);
  if ((tag === 'Xing' || tag === 'Info') && view.getUint32(at + 8 + frame.side) & 1)
    return (view.getUint32(at + 12 + frame.side) * frame.samples) / frame.rate;
  return ((bytes.length - at) * 8) / (frame.bitrate * 1000);
};

const readers = { 'audio/webm': webm, 'audio/mp4': mp4, 'audio/ogg': ogg, 'audio/wav': wav };
export type DurationMime = keyof typeof readers | 'audio/mpeg';
// A header that is cut short or malformed says nothing, rather than throwing.
export function audioDurationSeconds(bytes: Uint8Array, mime: DurationMime) {
  try {
    const seconds = (mime === 'audio/mpeg' ? mp3 : readers[mime])(
      bytes,
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
    return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}
