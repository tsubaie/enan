import 'server-only';
import { z } from 'zod';
import { AiCapability } from '@/core/config/ai-capabilities';
import { AiModel } from '@/core/config/ai-model-schema';
import { Locale } from '@/core/config/defaults';
export const AiPayload = z.object({
  capability: AiCapability,
  capabilityVersion: z.literal(1),
  promptVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  entityId: z.uuid(),
  revision: z.number().int().positive(),
  contentHash: z.string(),
  model: AiModel,
  locale: Locale,
  input: z.json(),
  reservedTokens: z.number().int().positive(),
  // ADR 0033: the most both attempts can cost at the snapshotted prices, in micro-dollars. Jobs
  // queued before the dollar limit carry none and reserve nothing against it.
  reservedCostMicros: z.number().int().nonnegative().default(0),
  maxOutputTokens: z.number().int().positive(),
});
export type AiPayload = z.infer<typeof AiPayload>;
export const AiOutput = z.object({
  output: z.json(),
  warnings: z.array(z.string()).default([]),
  discarded: z.boolean().optional(),
  appliedIds: z.array(z.uuid()).optional(),
});

export type AiOutput = z.infer<typeof AiOutput>;
