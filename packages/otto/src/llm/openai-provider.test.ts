import { describe, expect, it } from 'vitest';
import { createOttoOpenAIProvider } from './openai-provider.js';
import { OttoLLMError } from './ollama-provider.js';

describe('createOttoOpenAIProvider (sem credencial — sem chamada de rede)', () => {
  it('chat lança erro explícito quando OPENAI_API_KEY não existe, nunca cai pro Ollama sozinho', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = createOttoOpenAIProvider();
    await expect(provider.chat([{ role: 'user', content: 'oi' }])).rejects.toThrow(OttoLLMError);
  });

  it('healthCheck reporta down sem credencial, sem tentar rede', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = createOttoOpenAIProvider();
    const health = await provider.healthCheck();
    expect(health.status).toBe('down');
    expect(health.detail).toMatch(/OPENAI_API_KEY/);
  });

  it('healthCheck reporta ok (só presença de credencial) quando a env está configurada', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-fake-nao-usado-nesta-suite';
    try {
      const provider = createOttoOpenAIProvider();
      const health = await provider.healthCheck();
      expect(health.status).toBe('ok');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
