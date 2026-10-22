import { afterEach, expect, it, vi } from 'vitest';
import { loadModels, selectModels } from '../models';
const transport = vi.hoisted(() => ({ token: 'first-key', get: vi.fn(), write: vi.fn(), outcomes: vi.fn<() => Promise<{ model: string; status: string; error: string | null }[]>>(async () => []) }));
vi.mock('../sdk', () => ({ aiClient: async () => ({ get: transport.get, authToken: transport.token }) }));
vi.mock('@/core/db/settings-repo', () => ({ writeSetting: transport.write }));
vi.mock('@/core/db/client', () => ({ db: () => ({}) }));
vi.mock('@/core/db/ai-credentials-repo', () => ({ readAiCredentials: async () => undefined }));
vi.mock('@/core/db/ai-jobs-repo', () => ({ recentModelOutcomes: transport.outcomes }));
afterEach(() => vi.clearAllMocks());
const compatible = {
  id: 'vendor/structured',
  name: 'Structured',
  context_length: 64000,
  supported_parameters: ['structured_outputs'],
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  top_provider: { max_completion_tokens: 16000 },
  pricing: { prompt: '0.000001', completion: '0.000002' },
};
it('ADMIN-B25 lists only compatible text models and retains pricing and token limits', async () => {
  transport.get.mockResolvedValue({
    data: [compatible, { ...compatible, id: 'vendor/plain', supported_parameters: [] }],
  });
  expect(await loadModels()).toEqual([
    {
      id: compatible.id,
      name: compatible.name,
      contextLength: 64000,
      maxOutputTokens: 16000,
      inputPrice: 0.000001,
      outputPrice: 0.000002,
    },
  ]);
  expect(transport.get).toHaveBeenCalledWith('/v1/models/user', {
    query: { limit: 500, offset: 0 },
    headers: { 'anthropic-version': null },
  });
});
it('ADMIN-B25 rejects unavailable models without changing saved model settings', async () => {
  transport.get.mockResolvedValue({ data: [compatible] });
  await expect(
    selectModels(undefined, 'actor', { defaultModel: 'vendor/plain', fastModel: compatible.id }),
  ).rejects.toMatchObject({ code: 'ai_unavailable' });
  expect(transport.write).not.toHaveBeenCalled();
});

it('ADMIN-B27 hides models whose most recent invocation reports a routing failure', async () => {
  transport.outcomes.mockResolvedValueOnce([{ model: compatible.id, status: 'error', error: '{"status":404}' }]);
  expect(await loadModels()).toEqual([]);
});
it('ADMIN-B25 a stale catalog is served while the fresh one loads in the background', async () => {
  vi.useFakeTimers();
  transport.get.mockResolvedValue({ data: [compatible] });
  await loadModels();
  vi.advanceTimersByTime(61_000);
  let release: (value: object) => void = () => {};
  transport.get.mockReset().mockReturnValue(new Promise((resolve) => (release = resolve)));
  // The fetch has not answered, yet the stale list comes back at once.
  expect((await loadModels()).map((model) => model.id)).toEqual([compatible.id]);
  expect(transport.get).toHaveBeenCalledTimes(1);
  release({ data: [{ ...compatible, id: 'vendor/newer' }] });
  await vi.waitFor(async () =>
    expect((await loadModels()).map((model) => model.id)).toEqual(['vendor/newer']),
  );
  vi.useRealTimers();
});
it('ADMIN-B25 without a catalog, a caller that cannot wait is answered at once and the fetch runs behind it', async () => {
  // Another credential than the earlier tests' catalog was loaded for.
  transport.token = 'second-key';
  let release: (value: object) => void = () => {};
  transport.get.mockReturnValue(new Promise((resolve) => (release = resolve)));
  await expect(loadModels({ wait: false })).rejects.toMatchObject({ code: 'ai_unavailable' });
  expect(transport.get).toHaveBeenCalledTimes(1);
  release({ data: [compatible] });
  await vi.waitFor(async () =>
    expect((await loadModels({ wait: false })).map((model) => model.id)).toEqual([compatible.id]),
  );
});
