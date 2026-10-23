import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAiSettings, DEFAULT_AI_SETTINGS, generateSubtasksWithAI, listAiModels } from '../ollamaClient';

describe('AI connection settings', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAiSettings({ ...DEFAULT_AI_SETTINGS });
  });

  it('OpenAI-compatible: calls /chat/completions with the key and chosen model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"subtasks":["A","B"],"estimatedMinutes":30,"priority":"high"}' } }],
        })
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setAiSettings({ provider: 'openai', baseUrl: 'https://example.test/v1/', apiKey: 'sk-test', model: 'my-model' });

    const res = await generateSubtasksWithAI('Report');
    expect(res.subtasks).toEqual(['A', 'B']);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string).model).toBe('my-model');
  });

  it('lists Ollama models from a custom address', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'qwen3' }] })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const models = await listAiModels({ provider: 'ollama', baseUrl: 'http://192.168.1.5:11434', apiKey: '', model: '' });
    expect(models).toEqual(['llama3.2', 'qwen3']);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://192.168.1.5:11434/api/tags');
  });
});
