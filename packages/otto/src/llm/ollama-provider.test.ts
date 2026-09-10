import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createOttoLLMProvider, OttoLLMError } from './ollama-provider.js';
import type { OttoChatMessage } from './ollama-provider.js';

/**
 * Provider testado com fetch injetado: nenhum teste toca rede de verdade,
 * mas todo o caminho HTTP (URL, body, parse, retry) é exercido.
 */

const messages: OttoChatMessage[] = [{ role: 'user', content: 'olá' }];

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ message: { content } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chat', () => {
  it('retorna o conteúdo da mensagem', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => chatResponse('resposta do modelo'));
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const reply = await provider.chat(messages);
    expect(reply).toBe('resposta do modelo');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('nao manda campo think por default (deixa o default do modelo valer)', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => chatResponse('ok'));
    const provider = createOttoLLMProvider({ baseUrl: 'http://localhost:11434', model: 'mistral', fetchFn });
    await provider.chat(messages);
    const body = JSON.parse((fetchFn.mock.calls[0]?.[1]?.body as string) ?? '{}') as Record<string, unknown>;
    expect('think' in body).toBe(false);
  });

  it('suppressThinking: true manda think:false', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => chatResponse('ok'));
    const provider = createOttoLLMProvider({ baseUrl: 'http://localhost:11434', model: 'qwen3.5:4b', fetchFn });
    await provider.chat(messages, { suppressThinking: true });
    const body = JSON.parse((fetchFn.mock.calls[0]?.[1]?.body as string) ?? '{}') as { think?: boolean };
    expect(body.think).toBe(false);
  });

  it('suppressThinking: false NAO manda think:true (isso derrubaria modelo sem a capability)', async () => {
    // O Ollama responde {"error":"\"<modelo>\" does not support thinking"} pra
    // think:true em modelo que não pensa - verificado ao vivo no 0.33.3. Então
    // a opção é só de supressão: nenhum valor dela pode gerar HTTP 400.
    const fetchFn = vi.fn<typeof fetch>(async () => chatResponse('ok'));
    const provider = createOttoLLMProvider({ baseUrl: 'http://localhost:11434', model: 'mistral', fetchFn });
    await provider.chat(messages, { suppressThinking: false });
    const body = JSON.parse((fetchFn.mock.calls[0]?.[1]?.body as string) ?? '{}') as Record<string, unknown>;
    expect('think' in body).toBe(false);
  });

  it('lança OttoLLMError com causa quando a rede falha', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const error = await provider.chat(messages).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OttoLLMError);
    expect((error as OttoLLMError).cause).toBeInstanceOf(Error);
  });
});

describe('chatJson', () => {
  const schema = z.object({ titulo: z.string(), tags: z.array(z.string()) });

  it('parseia e valida JSON bem formado na primeira tentativa', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      chatResponse(JSON.stringify({ titulo: 'Campanha', tags: ['a'] })),
    );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const result = await provider.chatJson(messages, schema);
    expect(result.titulo).toBe('Campanha');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // format:'json' tem que estar no payload pro Ollama forçar JSON no decode.
    const body = JSON.parse((fetchFn.mock.calls[0]?.[1]?.body as string) ?? '{}') as {
      format?: string;
    };
    expect(body.format).toBe('json');
  });

  it('suprime raciocinio por default no caminho estruturado', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      chatResponse(JSON.stringify({ titulo: 'Campanha', tags: [] })),
    );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3.5:4b',
      fetchFn,
    });
    await provider.chatJson(messages, schema);
    const body = JSON.parse((fetchFn.mock.calls[0]?.[1]?.body as string) ?? '{}') as { think?: boolean };
    expect(body.think).toBe(false);
  });

  it('JSON com cerca de markdown NAO gasta uma segunda chamada de modelo', async () => {
    // Este é o ponto: a correção custava outra geração inteira (minutos no
    // hardware do Otto) por um problema de embrulho, não de conteúdo.
    const fetchFn = vi.fn<typeof fetch>(async () =>
      chatResponse('```json\n{"titulo":"Campanha","tags":["a"]}\n```'),
    );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const result = await provider.chatJson(messages, schema);
    expect(result.titulo).toBe('Campanha');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('JSON com prefacio em prosa tambem se resolve numa chamada', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      chatResponse('Claro, aqui vai:\n{"titulo":"Campanha","tags":[]}\n\nQualquer coisa me chama.'),
    );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    expect((await provider.chatJson(messages, schema)).titulo).toBe('Campanha');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('desembrulhar NAO conserta conteudo: schema errado continua indo pra correção', async () => {
    // JSON íntegro e desembrulhável, mas fora do schema (tags faltando). O
    // desembrulho não pode virar desculpa pra aceitar plano incompleto.
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => chatResponse('```json\n{"titulo":"Campanha"}\n```'))
      .mockImplementationOnce(async () => chatResponse(JSON.stringify({ titulo: 'Corrigido', tags: [] })));
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    expect((await provider.chatJson(messages, schema)).titulo).toBe('Corrigido');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchFn.mock.calls[1]?.[1]?.body as string) ?? '{}') as {
      messages: { role: string; content: string }[];
    };
    expect(retryBody.messages.at(-1)?.content).toContain('schema mismatch');
  });

  it('faz UMA tentativa de correção quando o JSON vem inválido', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => chatResponse('isso não é JSON'))
      .mockImplementationOnce(async () =>
        chatResponse(JSON.stringify({ titulo: 'Corrigido', tags: [] })),
      );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const result = await provider.chatJson(messages, schema);
    expect(result.titulo).toBe('Corrigido');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // O retry carrega o erro no prompt de correção.
    const retryBody = JSON.parse((fetchFn.mock.calls[1]?.[1]?.body as string) ?? '{}') as {
      messages: { role: string; content: string }[];
    };
    const correction = retryBody.messages.at(-1);
    expect(correction?.content).toContain('invalid JSON');
  });

  it('desiste com erro honesto se a correção também falhar', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => chatResponse('ainda quebrado'));
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    await expect(provider.chatJson(messages, schema)).rejects.toBeInstanceOf(OttoLLMError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('healthCheck', () => {
  it('ok quando o modelo está instalado (com ou sem tag :latest)', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ models: [{ name: 'mistral:latest' }] }), { status: 200 }),
    );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const health = await provider.healthCheck();
    expect(health.status).toBe('ok');
  });

  it('degraded quando o Ollama está no ar mas o modelo não está instalado', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3:latest' }] }), { status: 200 }),
    );
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const health = await provider.healthCheck();
    expect(health.status).toBe('degraded');
    expect(health.detail).toContain('mistral');
  });

  it('down quando o Ollama está inalcançável', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = createOttoLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'mistral',
      fetchFn,
    });
    const health = await provider.healthCheck();
    expect(health.status).toBe('down');
    expect(health.detail).toContain('ECONNREFUSED');
  });
});
