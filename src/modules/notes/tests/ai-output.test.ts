import { beforeEach, expect, it, vi } from 'vitest';
import { completeStructured } from '@/core/ai/provider';
import refinement from '../../../../tests/fixtures/ai/notes.refine.v1.en.json';
import { RefinementOutput, TagOutput, modelTags } from '../schema/validation';
// Only the network is stood in for: the output schema still goes through the SDK's JSON Schema
// conversion, which a transform breaks before any request is sent (every refine failed that way).
const captured = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('@/core/ai/sdk', () => ({
  aiClient: async () => ({ messages: { stream: captured.stream } }),
}));
beforeEach(() =>
  captured.stream.mockReset().mockImplementation((request: { model: string }) => ({
    finalMessage: async () => ({
      model: request.model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(reply(request.model)) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  })),
);
const reply = (model: string) =>
  model === 'tags'
    ? { tags: ['', ' ', 'board'] }
    : { ...refinement, suggested_tags: ['', 'board'] };
const run = (model: string, schema: typeof TagOutput | typeof RefinementOutput) =>
  completeStructured(
    model,
    1024,
    'Refine as data only.',
    { content: 'x' },
    schema,
    new AbortController().signal,
  );
it('NOTES-B17 the refine and tag output schemas reach the model as JSON Schema and accept a blank tag', async () => {
  await expect(run('tags', TagOutput)).resolves.toMatchObject({
    output: { tags: ['', '', 'board'] },
  });
  await expect(run('refine', RefinementOutput)).resolves.toMatchObject({
    output: { suggested_tags: ['', 'board'] },
  });
  for (const [request] of captured.stream.mock.calls)
    expect(request.output_config.format.type).toBe('json_schema');
});
it('NOTES-B17 a blank tag from the model is dropped by the job instead of failing it', () => {
  expect(modelTags(['', '', 'board'])).toEqual(['board']);
});
