import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { executeAi } from '@/core/ai/execute';
import { AiOutput, AiPayload } from '@/core/ai/job-schema';
import { KpiStatus, NarrativeAiOutput } from '../schema/validation';
import { NARRATIVE_PROMPT } from './prompts/narrative.v1';
import { completeNarrative } from './repo';
// The part of the snapshot a citation is resolved against.
const Cited = z.object({
  kpis: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), status: KpiStatus })),
});
// KPIS-B32: the brief is written from the snapshot taken when it was asked for, and every citation
// it makes is resolved back to a measure in that snapshot; a code it invented is dropped.
export const narrativeJob: JobHandler = {
  concurrency: 2,
  schema: AiPayload,
  run: async (job, signal) => {
    const output = await executeAi(job, NARRATIVE_PROMPT, NarrativeAiOutput, signal);
    const codes = new Set(Cited.parse(AiPayload.parse(job.payload).input).kpis.map((k) => k.code));
    const highlights = output.highlights.filter((highlight) => codes.has(highlight.code));
    return {
      output: { ...output, highlights },
      warnings: highlights.length < output.highlights.length ? ['unknown_citation'] : [],
    };
  },
  publish: async (database, job, raw) => {
    const payload = AiPayload.parse(job.payload);
    const output = NarrativeAiOutput.parse(AiOutput.parse(raw).output);
    const byCode = new Map(Cited.parse(payload.input).kpis.map((kpi) => [kpi.code, kpi]));
    await completeNarrative(database, payload.entityId, {
      headline: output.headline,
      bodyMarkdown: output.bodyMarkdown,
      highlightsJson: output.highlights.flatMap((highlight) => {
        const kpi = byCode.get(highlight.code);
        return kpi
          ? [
              {
                kpiId: kpi.id,
                code: kpi.code,
                name: kpi.name,
                status: kpi.status,
                summary: highlight.summary,
              },
            ]
          : [];
      }),
    });
  },
};
