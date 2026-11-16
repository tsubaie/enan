import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db, withTransaction } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { type Claimed } from '@/core/db/jobs-repo';
import { recordInvocation } from '@/core/db/ai-jobs-repo';
import { AppError } from '@/core/http/errors';
import { AiPayload } from './job-schema';
import { usageFields, failedUsage } from './usage';
import { retryDelay } from '@/core/time/ai';
import { aiExecutionLimits } from '@/core/config/ai';
import { completeStructured, transcribeAudio } from './provider';
function safeFailure(cause: unknown) {
  if (cause instanceof AppError) return cause;
  if (cause instanceof Anthropic.APIConnectionTimeoutError)
    return new AppError('ai_failed', { reason: 'timeout' });
  if (cause instanceof Anthropic.APIError && [402, 404].includes(cause.status))
    return providerStatusFailure(cause.status);
  if (cause instanceof Anthropic.AuthenticationError)
    return new AppError('ai_failed', { reason: 'invalid_key' });
  if (cause instanceof Anthropic.RateLimitError)
    return new AppError('ai_failed', {
      reason: 'rate_limit',
      retryAfterMs: retryDelay(cause.headers?.get('retry-after')),
    });
  if (
    cause instanceof Anthropic.APIConnectionError ||
    (cause instanceof Anthropic.APIError && cause.status >= 500)
  )
    return new AppError('ai_failed', { reason: 'network' });
  return new AppError('ai_failed', {
    reason: 'provider',
    ...(cause instanceof Anthropic.APIError ? { status: cause.status } : {}),
  });
}
type Recorded<T> = {
  value: T;
  model: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    estimatedCostMicros: number | null;
  };
};
// Every provider call leaves one invocation row: its usage and cost when it answered, the
// reserved estimate and the safe reason when it did not.
async function recorded<T>(job: Claimed, call: (payload: AiPayload) => Promise<Recorded<T>>) {
  const payload = AiPayload.parse(job.payload);
  const started = Date.now();
  const base = {
    id: id(),
    jobId: job.id,
    capability: payload.capability,
    capabilityVersion: 1,
    requestedModel: payload.model.id,
    createdBy: job.createdBy,
    pricingVersion: `openrouter-catalog-v1:${job.createdAt.toISOString()}`,
  };
  try {
    const result = await call(payload);
    await withTransaction(db(), (database) =>
      recordInvocation(database, {
        ...base,
        effectiveModel: result.model,
        status: 'ok',
        ...result.usage,
        latencyMs: Date.now() - started,
      }),
    );
    return result.value;
  } catch (cause) {
    const error = safeFailure(cause);
    await withTransaction(db(), (database) =>
      recordInvocation(database, {
        ...base,
        status: 'error',
        ...failedUsage(error.details, payload),
        error: JSON.stringify(error.details),
        latencyMs: Date.now() - started,
      }),
    );
    throw error;
  }
}
export function executeAi<S extends z.ZodType>(
  job: Claimed,
  system: string,
  schema: S,
  signal: AbortSignal,
) {
  return recorded(job, async (payload) => {
    const result = await completeStructured(
      payload.model.id,
      payload.maxOutputTokens,
      system,
      payload.input,
      schema,
      signal,
      payload.capability === 'notes.suggest_tags'
        ? aiExecutionLimits.tags.timeoutMs
        : aiExecutionLimits.defaultTimeoutMs,
    );
    return { value: result.output, model: result.model, usage: usageFields(result.usage, payload) };
  });
}
// ADR 0070: speech to text. The provider reports what the call cost, which is what is counted.
export function executeTranscription(
  job: Claimed,
  audio: { bytes: Uint8Array; format: string },
  signal: AbortSignal,
) {
  return recorded(job, async (payload) => {
    const result = await transcribeAudio(payload.model.id, audio, signal);
    return {
      value: result.text,
      model: payload.model.id,
      usage: {
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
        estimatedCostMicros: Math.ceil(1000000 * (result.usage?.cost ?? 0)),
      },
    };
  });
}

function providerStatusFailure(status: number) {
  return new AppError(
    'ai_failed',
    status === 402 ? { reason: 'billing' } : { reason: 'model_unavailable', status },
  );
}
