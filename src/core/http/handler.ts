import 'server-only';
import { z } from 'zod';
import {
  db,
  readOnlyDb,
  withTransaction,
  DatabaseBusyError,
  type Database,
} from '@/core/db/client';
import { currentUser, type Context } from '@/core/auth/session';
import { createHmac } from 'node:crypto';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import { replayRequest, storeRequest, maintenance } from '@/core/db/http-repo';
import { AppError, statuses } from './errors';
import { checkOrigin } from './origin';
import { logger } from '@/core/config/logger';
import { getTranslations } from 'next-intl/server';
import type { User } from '@/core/auth/validation';
import { isRestoring } from '@/core/backup/maintenance';

let maintenanceState: { value: boolean; expires: number } | undefined;
// Both checks hit storage; two seconds of staleness is acceptable for a maintenance banner.
export async function inMaintenance() {
  if (maintenanceState && maintenanceState.expires > Date.now()) return maintenanceState.value;
  const value = (await isRestoring()) || (await maintenance(db()));
  maintenanceState = { value, expires: Date.now() + 2000 };
  return value;
}

type HandlerContext = { user: User | null; db: Database; requestId: string };
export type HandlerMeta = {
  guard: 'public' | 'session' | 'admin';
  input: z.ZodType;
  response: z.ZodType;
  status: number;
  source: 'body' | 'query' | 'form';
  idempotent: boolean;
  enqueues: boolean;
};
type Options<I extends z.ZodType, O extends z.ZodType> = {
  guard: 'public' | 'session' | 'admin';
  input: I;
  response: O;
  // `form` reads a multipart body (an upload), refused unread when its declared length is over
  // `maxBytes`, so an oversized file is never buffered.
  source?: 'body' | 'query' | 'form';
  maxBytes?: () => number;
  status?: number;
  idempotent?: boolean;
  // The route may enqueue a job, so a full queue answers 429 (OpenAPI lists it).
  enqueues?: boolean;
  // ADR 0067: a GET runs on the pool without a transaction, outside the write queue, on a handle
  // that refuses a write; `true` keeps the request's transaction for a GET that must write (none
  // today). `false` takes a slow handler of another method (hashing files, calling a provider) out
  // of the queue too (ADR 0045); it may write only through its service's own transaction (ADR 0054).
  transaction?: boolean;
  handler: (
    input: z.output<I>,
    ctx: HandlerContext,
    params: Record<string, string>,
    request: Request,
  ) => Promise<z.input<O>>;
};
export function authenticated(ctx: HandlerContext): Context {
  if (!ctx.user) throw new AppError('unauthenticated');
  return { ...ctx, user: ctx.user };
}
async function formFor(request: Request, maxBytes?: () => number) {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (maxBytes && !Number.isFinite(declared)) throw new AppError('validation_failed');
  if (maxBytes && declared > maxBytes())
    throw new AppError('rule_violation', { reason: 'too_large' });
  try {
    return Object.fromEntries((await request.formData()).entries());
  } catch {
    throw new AppError('validation_failed');
  }
}
async function inputFor(request: Request, source?: 'body' | 'query' | 'form') {
  if (source === 'query' || request.method === 'GET')
    return Object.fromEntries(new URL(request.url).searchParams);
  const body = await request.text();
  if (body.length > 1000000) throw new AppError('validation_failed');
  try {
    return body ? z.json().parse(JSON.parse(body)) : {};
  } catch {
    throw new AppError('validation_failed');
  }
}
// Every API response says how long the origin spent on it (`Server-Timing`), split into the
// session check and the transaction that ran the handler, so a slow response can be placed at the
// edge or at the origin from the browser's own network panel.
function serverTiming(started: number, marks: { auth?: number; db?: number }) {
  const total = performance.now() - started;
  const parts = [
    ...(marks.auth === undefined ? [] : [`auth;dur=${marks.auth.toFixed(1)}`]),
    ...(marks.db === undefined ? [] : [`db;dur=${marks.db.toFixed(1)}`]),
    `total;dur=${total.toFixed(1)}`,
  ];
  return { 'Server-Timing': parts.join(', ') };
}
export function defineHandler<I extends z.ZodType, O extends z.ZodType>(options: Options<I, O>) {
  const handler = async (request: Request, route?: { params: Promise<Record<string, string>> }) => {
    const requestId = id();
    const started = performance.now();
    const marks: { auth?: number; db?: number } = {};
    try {
      if (await inMaintenance())
        return Response.json(
          { error: { code: 'maintenance', requestId } },
          { status: 503, headers: serverTiming(started, marks) },
        );
      const user = await currentUser({ slide: true });
      marks.auth = performance.now() - started;
      if (options.guard !== 'public' && !user) throw new AppError('unauthenticated');
      if (options.guard === 'admin' && user?.role !== 'admin')
        throw new AppError('forbidden', { reason: 'role' });
      checkOrigin(request);
      const raw =
        options.source === 'form'
          ? await formFor(request, options.maxBytes)
          : await inputFor(request, options.source);
      const input = options.input.parse(raw);
      const params = route ? await route.params : {};
      const executing = performance.now();
      const result = await execute(options, input, { user, db: db(), requestId }, params, request);
      marks.db = performance.now() - executing;
      if (options.status === 204)
        return new Response(null, {
          status: 204,
          headers: {
            'X-Op-Id': z.object({ opId: z.string() }).parse(result).opId,
            'X-Request-Id': requestId,
            ...serverTiming(started, marks),
          },
        });
      return Response.json(result, {
        status: options.status ?? 200,
        headers: {
          'X-Request-Id': requestId,
          'Cache-Control': 'no-store',
          ...serverTiming(started, marks),
        },
      });
    } catch (error) {
      const response = await errorResponse(error, requestId);
      response.headers.set('Server-Timing', serverTiming(started, marks)['Server-Timing']);
      return response;
    }
  };
  return Object.assign(handler, { meta: metaOf(options) });
}
function metaOf<I extends z.ZodType, O extends z.ZodType>(options: Options<I, O>): HandlerMeta {
  return {
    guard: options.guard,
    input: options.input,
    response: options.response,
    status: options.status ?? 200,
    source: options.source ?? 'body',
    idempotent: options.idempotent ?? false,
    enqueues: options.enqueues ?? false,
  };
}
async function execute<I extends z.ZodType, O extends z.ZodType>(
  options: Options<I, O>,
  input: z.output<I>,
  ctx: HandlerContext,
  params: Record<string, string>,
  request: Request,
) {
  const transactional = options.transaction ?? request.method !== 'GET';
  if (!transactional)
    return z.json().parse(
      options.response.parse(
        await options.handler(input, { ...ctx, db: readOnlyDb() }, params, request),
      ),
    );
  // One immediate transaction per request (ADR 0029): a retry carrying the same Idempotency-Key
  // waits at BEGIN until the first attempt commits, then replays its stored response.
  const outcome = await withTransaction(db(), async (database) => {
    const key = options.idempotent ? z.uuid().parse(request.headers.get('idempotency-key')) : null;
    // Keyed, because the input can hold a password (an account change asks for the current one):
    // a plain SHA-256 of it in a stolen backup could be guessed at GPU speed, bypassing argon2.
    const hash = createHmac('sha256', env().SESSION_SECRET)
      .update(JSON.stringify({ method: request.method, url: request.url, input }))
      .digest('hex');
    if (key && ctx.user) {
      const previous = await replayRequest(database, ctx.user.id, key);
      if (previous) {
        if (previous.requestHash !== hash) throw new AppError('conflict', { reason: 'duplicate' });
        return previous.body;
      }
    }
    let output: unknown;
    try {
      output = await options.handler(input, { ...ctx, db: database }, params, request);
    } catch (error) {
      if (error instanceof AppError && error.commit) return error;
      throw error;
    }
    const json = z.json().parse(options.response.parse(output));
    if (key && ctx.user)
      await storeRequest(database, ctx.user.id, key, hash, options.status ?? 200, json);
    return json;
  });
  if (outcome instanceof AppError) throw outcome;
  return outcome;
}
// ADMIN-B38: a transaction the busy retry gave up on is contention, not a fault. It is logged as a
// warning and answered with the retryable envelope (docs/04 § errors): 429 `rate_limited`, scope
// `database`, and a one-second Retry-After, since the holder has most likely finished by then.
function busyResponse(error: unknown, requestId: string) {
  if (!(error instanceof DatabaseBusyError)) return null;
  logger.warn({ requestId, err: error }, 'Request waited out the database write lock');
  return new AppError('rate_limited', { scope: 'database', retryAfterSeconds: 1 });
}
async function errorResponse(error: unknown, requestId: string) {
  const parsed =
    error instanceof z.ZodError
      ? new AppError('validation_failed', {
          fieldErrors: Object.fromEntries(error.issues.map((i) => [i.path.join('.'), [i.message]])),
        })
      : error instanceof AppError
        ? error
        : (busyResponse(error, requestId) ?? new AppError('internal'));
  if (parsed.code === 'internal') logger.error({ requestId, err: error }, 'Request failed');
  const t = await getTranslations('errors');
  const retry = z.object({ retryAfterSeconds: z.number() }).safeParse(parsed.details);
  return Response.json(
    { error: { code: parsed.code, message: t(parsed.code), details: parsed.details, requestId } },
    {
      status: statuses[parsed.code],
      headers: {
        'Cache-Control': 'no-store',
        ...(retry.success
          ? { 'Retry-After': String(Math.ceil(retry.data.retryAfterSeconds)) }
          : {}),
      },
    },
  );
}
