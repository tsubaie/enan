import { env } from '@/core/config/env';
import { createCommittee } from '@/modules/committees/service';
import { CommitteeCreate } from '@/modules/committees/schema/validation';
import { db } from '@/core/db/client';
import { insertUser } from '@/core/db/auth-repo';
import { files, jobs } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { User } from '@/core/http/user-schema';
import { people } from '@/modules/people/schema/db';
import { captures, captureSuggestions } from '../schema/db';
// Rows written straight to the tables: the capture services that create them arrive with
// recording, and these scenarios are about the shape and who may read it.
export async function user(name: string, role: 'admin' | 'member') {
  return User.parse(
    await insertUser(db(), {
      id: id(),
      name,
      email: `${name.toLowerCase().replace(/\W+/gu, '.')}@example.test`,
      passwordHash: 'unused-test-hash',
      role,
    }),
  );
}
export async function audioFile() {
  const sha256 = id().replaceAll('-', '');
  const [row] = await db()
    .insert(files)
    .values({
      id: id(),
      storageKey: `voice-${sha256}`,
      originalName: 'Recording.webm',
      mime: 'audio/webm',
      sizeBytes: 2048,
      sha256,
    })
    .returning();
  if (!row) throw new Error('file not inserted');
  return row;
}
export async function capture(recorder: User, fields: Partial<typeof captures.$inferInsert> = {}) {
  const file = await audioFile();
  const [row] = await db()
    .insert(captures)
    .values({
      id: id(),
      fileId: file.id,
      createdBy: recorder.id,
      updatedBy: recorder.id,
      ...fields,
    })
    .returning();
  if (!row) throw new Error('capture not inserted');
  return row;
}
export async function suggestion(
  captureId: string,
  fields: Partial<typeof captureSuggestions.$inferInsert> = {},
) {
  const [row] = await db()
    .insert(captureSuggestions)
    .values({ id: id(), captureId, kind: 'task', payload: { title: 'Follow up' }, ...fields })
    .returning();
  if (!row) throw new Error('suggestion not inserted');
  return row;
}
// A WebM recording by its magic bytes; the seed keeps each test's content hash its own.
export const webm = (seed: number, size = 2048) => {
  const audio = new Uint8Array(size).map((_, index) => (index * 31 + seed) % 251);
  audio.set([0x1a, 0x45, 0xdf, 0xa3]);
  return audio;
};
type Handler = (
  request: Request,
  route: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const headers = (extra: Record<string, string> = {}) => ({
  Origin: env().APP_URL,
  'X-Requested-With': 'Enan',
  'Idempotency-Key': crypto.randomUUID(),
  ...extra,
});
async function respond(handler: Handler, request: Request, params: Record<string, string>) {
  const response = await handler(request, { params: Promise.resolve(params) });
  const body = response.headers.get('content-type')?.includes('json')
    ? await response.json()
    : null;
  return { status: response.status, body, response };
}
// A handler as its route exports it, with a JSON body (or none for GET and DELETE).
export function call(
  handler: Handler,
  method: string,
  path: string,
  params: Record<string, string> = {},
  body?: object,
  extra: Record<string, string> = {},
) {
  const request = new Request(new URL(`/api/v1${path}`, env().APP_URL), {
    method,
    headers: headers({ ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return respond(handler, request, params);
}
// The create route with a real multipart body; the declared type is deliberately wrong.
export async function record(
  handler: Handler,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'Board debrief.webm', { type: 'text/html' }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const encoded = new Response(form);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  const request = new Request(new URL('/api/v1/captures', env().APP_URL), {
    method: 'POST',
    headers: headers({
      'Content-Type': encoded.headers.get('content-type') ?? '',
      'Content-Length': String(raw.byteLength),
    }),
    body: raw,
  });
  return respond(handler, request, {});
}
export async function committee(owner: User, name: string) {
  return createCommittee(
    { db: db(), user: owner, requestId: id() },
    CommitteeCreate.parse({ name }),
  );
}
// A transcription job still in the queue, for a capture that is waiting on it.
export async function queuedJob() {
  const jobId = id();
  await db().insert(jobs).values({ id: jobId, kind: 'ai.captures.transcribe', payload: {} });
  return jobId;
}
// An assignable person, optionally the person of a signed-in member (who can then be notified).
export async function person(name: string, login: User | null = null) {
  const [row] = await db()
    .insert(people)
    .values({
      id: id(),
      fullName: name,
      kind: 'internal',
      isAssignable: true,
      userId: login?.id ?? null,
    })
    .returning();
  if (!row) throw new Error('person not inserted');
  return row;
}
