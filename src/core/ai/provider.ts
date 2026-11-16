import 'server-only';
import { z } from 'zod';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { framedInput } from './framing';
import { ProviderUsage } from './usage';
import { aiClient } from './sdk';
import { aiExecutionLimits } from '@/core/config/ai';
import { AppError } from '@/core/http/errors';
export async function completeStructured<S extends z.ZodType>(
  model: string,
  maxOutputTokens: number,
  system: string,
  input: z.infer<ReturnType<typeof z.json>>,
  output: S,
  signal: AbortSignal,
  timeoutMs = aiExecutionLimits.defaultTimeoutMs,
) {
  const client = await aiClient(timeoutMs);
  if (!client) throw new AppError('ai_unavailable');
  const messages: MessageParam[] = [{ role: 'user', content: framedInput(input) }];
  const params = {
    model,
    max_tokens: maxOutputTokens,
    system,
    messages,
    output_config: { format: zodOutputFormat(output) },
    provider: { require_parameters: true },
  };
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, deadline]);
  const response = await client.messages
    .stream(params, { signal: combined })
    .finalMessage()
    .catch((error) => {
      if (deadline.aborted && !signal.aborted)
        throw new AppError('ai_failed', { reason: 'timeout' });
      throw error;
    });
  const parsedUsage = ProviderUsage.safeParse(response.usage);
  const usageDetail = parsedUsage.success ? { usage: z.json().parse(parsedUsage.data) } : {};
  if (response.stop_reason !== 'end_turn')
    throw new AppError('ai_failed', {
      reason: response.stop_reason === 'refusal' ? 'refused' : 'invalid_output',
      ...usageDetail,
    });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return { output: output.parse(JSON.parse(text)), model: response.model, usage: response.usage };
  } catch {
    throw new AppError('ai_failed', { reason: 'invalid_output', ...usageDetail });
  }
}
// ADR 0070: OpenRouter's speech-to-text endpoint, reached through the same client (its key and
// base URL) as every other call. The audio goes inline as base64 with its container format.
const Transcription = z.object({
  text: z.string(),
  usage: z
    .object({
      cost: z.number().nonnegative(),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .partial()
    .optional(),
});
export async function transcribeAudio(
  model: string,
  audio: { bytes: Uint8Array; format: string },
  signal: AbortSignal,
) {
  const timeoutMs = aiExecutionLimits.transcription.timeoutMs;
  const client = await aiClient(timeoutMs);
  if (!client) throw new AppError('ai_unavailable');
  const deadline = AbortSignal.timeout(timeoutMs);
  const raw: unknown = await client
    .post('/v1/audio/transcriptions', {
      body: {
        model,
        input_audio: { data: Buffer.from(audio.bytes).toString('base64'), format: audio.format },
      },
      headers: { 'anthropic-version': null },
      signal: AbortSignal.any([signal, deadline]),
    })
    .catch((error) => {
      if (deadline.aborted && !signal.aborted)
        throw new AppError('ai_failed', { reason: 'timeout' });
      throw error;
    });
  const parsed = Transcription.safeParse(raw);
  if (!parsed.success) throw new AppError('ai_failed', { reason: 'invalid_output' });
  return parsed.data;
}
