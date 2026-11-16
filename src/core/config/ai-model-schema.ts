import { z } from 'zod';
export const ModelId = z
  .string()
  .max(200)
  .regex(/^~?[a-z0-9_-]+\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
export const AiModel = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number(),
  maxOutputTokens: z.number(),
  inputPrice: z.number(),
  outputPrice: z.number(),
});
export const AiModels = z.object({
  models: z.array(AiModel),
  defaultModel: z.string(),
  fastModel: z.string(),
  // ADR 0070: speech-to-text models are a catalog of their own; empty when it could not be read.
  transcriptionModels: z.array(AiModel).default([]),
  transcriptionModel: z.string(),
});
export const AiModelSelection = z.strictObject({
  defaultModel: ModelId,
  fastModel: ModelId,
  transcriptionModel: ModelId.optional(),
});

export function supportsModelSlot(model: z.infer<typeof AiModel>, slot: 'default' | 'fast') {
  const outputLimit = Math.min(model.maxOutputTokens, slot === 'default' ? 16000 : 4096);
  return outputLimit > 0 && model.contextLength > 8192 + outputLimit;
}
