// A stored recording answered as a file. A `Range` request gets the slice it asks for (206), so
// the player can seek; one outside the file gets 416.
export function audioResponse(
  request: Request,
  audio: { mime: string; name: string; bytes: Uint8Array },
  cache: string,
) {
  const total = audio.bytes.byteLength;
  const headers = {
    'Content-Type': audio.mime,
    'Content-Disposition': disposition(audio.name),
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  const range = request.headers.get('range');
  if (!range)
    return new Response(new Uint8Array(audio.bytes), {
      headers: { ...headers, 'Content-Length': String(total) },
    });
  const slice = byteRange(range, total);
  if (!slice)
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${total}` },
    });
  const [start, end] = slice;
  return new Response(new Uint8Array(audio.bytes.subarray(start, end + 1)), {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${total}`,
    },
  });
}
// A header is Latin-1, and an Arabic name is not: an ASCII stand-in, then the name itself (RFC 5987).
const disposition = (name: string) =>
  `inline; filename="${name.replace(/[^\x20-\x7e]/gu, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
// One `bytes=start-end`, `bytes=start-` or `bytes=-suffix` range, clamped to the file.
function byteRange(header: string, total: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || total === 0) return null;
  const [, from = '', to = ''] = match;
  if (!from && !to) return null;
  const start = from ? Number(from) : Math.max(0, total - Number(to));
  const end = from && to ? Math.min(Number(to), total - 1) : total - 1;
  return start <= end && start < total ? [start, end] : null;
}
