import { z } from 'zod';
import { AiCapability } from './ai-capabilities';
// ADR 0033: the monthly AI limit is money, in integer micro-dollars (the unit every stored cost
// estimate already uses), capped at one billion dollars so arithmetic stays exact.
export const MonthlyBudgetMicros = z.number().int().positive().max(1e15);
export const AiControlsWrite = z.strictObject({
  enabledCapabilities: z.array(AiCapability).max(3),
  monthlyBudgetMicros: MonthlyBudgetMicros.nullable(),
});
export const AiUsageRow = z.object({ capability: z.string(), calls: z.number(), inputTokens: z.number(), outputTokens: z.number(), cacheTokens: z.number(), estimatedCostMicros: z.number() });
export const AiControls = AiControlsWrite.extend({
  usedTokens: z.number(), reservedTokens: z.number(),
  usedCostMicros: z.number(), reservedCostMicros: z.number(),
  usage: z.array(AiUsageRow),
});
