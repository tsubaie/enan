import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Context } from '@/core/auth/session';
import { getSetting } from '@/core/db/settings-repo';
import { enqueue } from '@/core/db/jobs-repo';
import { aiAdmissionUsage, prepareAiJob, latestAiJob } from '@/core/db/ai-jobs-repo';
import { monthStart } from '@/core/time/ai';
import { aiExecutionLimits } from '@/core/config/ai';
import { AiModel, supportsModelSlot } from '@/core/config/ai-model-schema';
import { AiCapability } from '@/core/config/ai-capabilities';
import { AppError } from '@/core/http/errors';
import { env } from '@/core/config/env';
import { loadModels } from './models';
import { credentialStatus } from './credentials';
import { aiConnection, checkConnection } from './client';
import { framedInput } from './framing';
import { AiPayload } from './job-schema';
export function contentHash(input: z.infer<ReturnType<typeof z.json>>) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
// Shared per process like the status it refreshes (client.ts), so one check runs, not one per chunk.
declare global {
  var enanAiConnectionCheck: ReturnType<typeof checkConnection> | undefined;
}
// `wait` only from a route without a transaction (the availability read): a provider call may
// take seconds, and inside the write lock it would hold up every other writer. Otherwise a
// never-checked connection or a missing catalog is fetched in the background and AI is not ready yet.
export async function availableCapabilities(ctx: Context, wait = false) {
  if (!env().JOBS_ENABLED) return [];
  const connection = aiConnection();
  if (connection.checkedAt === null && wait) await checkConnection(ctx.db);
  else if (connection.checkedAt === null || Date.now() - Date.parse(connection.checkedAt) > 60000)
    globalThis.enanAiConnectionCheck ??= checkConnection().finally(
      () => (globalThis.enanAiConnectionCheck = undefined),
    );
  if (aiConnection().state !== 'enabled') return [];
  const enabled = await getSetting(ctx.db, 'ai.enabled_capabilities');
  const defaultModel = await getSetting(ctx.db, 'ai.model.default');
  const fastModel = await getSetting(ctx.db, 'ai.model.fast');
  try {
    const models = await loadModels({ wait });
    return enabled.filter((capability) => {
      // ADR 0070: the transcription model is not a chat model, so the chat catalog cannot vouch
      // for it; a model the provider does not serve fails its job with that reason.
      if (capability === 'notes.transcribe') return true;
      const slot = capability === 'notes.suggest_tags' ? 'fast' : 'default';
      return models.some(
        (model) =>
          model.id === (slot === 'fast' ? fastModel : defaultModel) &&
          supportsModelSlot(model, slot),
      );
    });
  } catch {
    return [];
  }
}
// Whether this workspace means to use AI at all: a provider credential exists and at least one
// capability is turned on. It is the difference between a fault a reader should hear about and a
// feature this office simply does not use, which is not news on any record, let alone every one.
// `availableCapabilities` refreshes the connection first, so the state read here is the fresh one.
export async function aiAvailability(ctx: Context) {
  // Only the availability route calls this, and it runs without a transaction.
  const capabilities = await availableCapabilities(ctx, true);
  const enabled = await getSetting(ctx.db, 'ai.enabled_capabilities');
  const configured =
    env().JOBS_ENABLED && aiConnection().state !== 'disabled' && enabled.length > 0;
  return { capabilities, configured };
}
// CAPTURES-B22: transcription is switched off in this workspace (jobs off, no provider key, or the
// capability not enabled), as distinct from unavailable for now (provider down, budget, rate
// limit), which Retry may outlast. Reads settings only, never the provider: the connection state
// is unknown until its first check, so it cannot say whether a key exists.
export async function transcriptionSwitchedOff(ctx: Context) {
  if (!env().JOBS_ENABLED) return true;
  if ((await credentialStatus(ctx.db)).source === 'none') return true;
  return !(await getSetting(ctx.db, 'ai.enabled_capabilities')).includes('notes.transcribe');
}
export async function admitAi(
  ctx: Context,
  capability: z.infer<typeof AiCapability>,
  entityId: string,
  revision: number,
  input: z.infer<ReturnType<typeof z.json>>,
  options: { autoApply?: boolean; audioSeconds?: number; queue?: Queue } = {},
) {
  if (!(await availableCapabilities(ctx)).includes(capability))
    throw new AppError('ai_unavailable');
  const queue = options.queue ?? {
    kind: `ai.${capability}`,
    dedupKey: `${capability}:${entityId}`,
  };
  if (capability === 'notes.transcribe')
    return admit(ctx, capability, entityId, revision, input, queue, {
      ...(await transcriptionModel(ctx, options.audioSeconds ?? 0)),
    });
  return admit(ctx, capability, entityId, revision, input, queue, {
    ...(await chooseModel(ctx, capability, input)),
    ...(options.autoApply ? { autoApply: true } : {}),
  });
}
// CAPTURES-B05: a capability's budget, model and limits on a job kind of the caller's own, so a
// capture is transcribed by the transcription capability without entering `ai.notes.transcribe`,
// whose publish writes into a note.
type Queue = { kind: `ai.${string}`; dedupKey: string };
type Chosen = {
  model: z.infer<typeof AiModel>;
  maxOutputTokens: number;
  estimate: number;
  reserveMicros: number;
  autoApply?: boolean;
};
async function admit(
  ctx: Context,
  capability: z.infer<typeof AiCapability>,
  entityId: string,
  revision: number,
  input: z.infer<ReturnType<typeof z.json>>,
  queue: Queue,
  { model, maxOutputTokens, estimate, reserveMicros, autoApply }: Chosen,
) {
  const locale = await getSetting(ctx.db, 'user.locale', ctx.user.id);
  const payload = AiPayload.parse({
    capability,
    entityId,
    revision,
    input,
    model,
    locale,
    capabilityVersion: 1,
    promptVersion: capability === 'notes.refine' ? 3 : 1,
    contentHash: contentHash(input),
    maxOutputTokens,
    reservedTokens: 2 * (estimate + maxOutputTokens),
    reservedCostMicros: reserveMicros,
    ...(autoApply ? { autoApply } : {}),
  });
  // Admission runs inside the request's immediate transaction (ADR 0029): the active-job read,
  // the usage count and the enqueue cannot interleave with another admission.
  const active = await latestAiJob(ctx.db, ctx.user.id, entityId, queue.kind);
  if (active && ['queued', 'running'].includes(active.status)) return { id: active.id };
  const budget = await getSetting(ctx.db, 'ai.monthly_budget_micros');
  const usage = await aiAdmissionUsage(
    ctx.db,
    ctx.user.id,
    queue.kind,
    monthStart(await getSetting(ctx.db, 'workspace.timezone')),
  );
  if (env().AI_RATE_LIMIT_ENABLED && usage.count >= (capability === 'notes.suggest_tags' ? 60 : 30))
    throw new AppError('ai_unavailable', {
      reason: 'rate_limit',
      retryAfterMs: usage.retryAfterMs,
      limit: capability === 'notes.suggest_tags' ? 60 : 30,
    });
  if (budget !== null && usage.costMicros + payload.reservedCostMicros > budget)
    throw new AppError('ai_unavailable', { reason: 'budget' });
  const job = await enqueue(
    ctx.db,
    queue.kind,
    z.json().parse(payload),
    queue.dedupKey,
    ctx.user.id,
  );
  if (job.createdBy !== ctx.user.id) throw new AppError('conflict', { reason: 'state' });
  await prepareAiJob(ctx.db, job.id, entityId);
  return { id: job.id };
}

// ADR 0070: a speech-to-text model is priced by the second, not by the token, and is not in the
// chat catalog: the payload names it and reserves a ceiling for the audio's length, both attempts.
async function transcriptionModel(ctx: Context, audioSeconds: number): Promise<Chosen> {
  const id = await getSetting(ctx.db, 'ai.model.transcription');
  return {
    model: { id, name: id, contextLength: 0, maxOutputTokens: 1, inputPrice: 0, outputPrice: 0 },
    maxOutputTokens: 1,
    estimate: 0,
    reserveMicros:
      2 * Math.max(1, audioSeconds) * aiExecutionLimits.transcription.reserveMicrosPerSecond,
  };
}
async function chooseModel(
  ctx: Context,
  capability: z.infer<typeof AiCapability>,
  input: z.infer<ReturnType<typeof z.json>>,
) {
  const slot = capability === 'notes.suggest_tags' ? 'ai.model.fast' : 'ai.model.default';
  const selected = await getSetting(ctx.db, slot);
  const model = (await loadModels({ wait: false })).find((entry) => entry.id === selected);
  if (!model) throw new AppError('ai_unavailable', { reason: 'model' });
  const maxOutputTokens = Math.min(
    capability === 'notes.refine'
      ? 16000
      : capability === 'notes.suggest_tags'
        ? aiExecutionLimits.tags.maxOutputTokens
        : 4096,
    model.maxOutputTokens,
  );
  const estimate = Buffer.byteLength(framedInput(input)) + 8192;
  if (estimate + maxOutputTokens > model.contextLength)
    throw new AppError('ai_unavailable', { reason: 'context' });
  // ADR 0033: the most two attempts can cost at the selected model's catalog prices (dollars per
  // token), in micro-dollars. The estimate is released when the job ends and its calls count.
  const reserveMicros = Math.ceil(
    2 * 1000000 * (model.inputPrice * estimate + model.outputPrice * maxOutputTokens),
  );
  return { model, maxOutputTokens, estimate, reserveMicros };
}
