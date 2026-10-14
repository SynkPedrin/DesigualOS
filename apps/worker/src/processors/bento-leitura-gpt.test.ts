import { describe, expect, it, vi } from 'vitest';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import { lerComGptPrimeiro, montarPromptDeLeitura } from './bento-leitura-gpt';

function resposta(answer: string | null, status: ExecuteResponse['status'] = 'completed'): ExecuteResponse {
  return {
    execution_id: '',
    agent: 'bento',
    status,
    answer,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

const gpuFora = () => Promise.resolve({ ...resposta(null, 'failed'), error: 'Ollama 502' });

describe('lerComGptPrimeiro', () => {
  it('GPT primário respondeu: a GPU nem é chamada', async () => {
    const gpu = vi.fn(gpuFora);
    const r = await lerComGptPrimeiro({
      gptPrimario: true,
      perguntarAoGpt: () => Promise.resolve(resposta('o Desigual OS é...')),
      perguntarAGpu: gpu,
    });
    expect(r.camada).toBe('openai_leitura_primaria');
    expect(r.resposta.answer).toBe('o Desigual OS é...');
    expect(gpu).not.toHaveBeenCalled();
  });

  /**
   * O caso medido em produção em 13/10/2026: GPU com 502. Antes, a pessoa
   * recebia INFERENCE_UPSTREAM_5XX; o GPT nem era tentado.
   */
  it('GPU fora e GPT de pé: a pessoa recebe resposta, não o erro da GPU', async () => {
    const gpt = vi
      .fn<() => Promise<ExecuteResponse | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resposta('resposta do socorro'));
    const r = await lerComGptPrimeiro({ gptPrimario: true, perguntarAoGpt: gpt, perguntarAGpu: gpuFora });
    expect(r.camada).toBe('openai_leitura_fallback_gpu');
    expect(r.resposta.answer).toBe('resposta do socorro');
    expect(gpt).toHaveBeenCalledTimes(2);
  });

  it('com o GPT fora de primário, a GPU responde primeiro e o GPT segue de socorro', async () => {
    const gpt = vi.fn(() => Promise.resolve(resposta('socorro')));
    const ok = await lerComGptPrimeiro({
      gptPrimario: false,
      perguntarAoGpt: gpt,
      perguntarAGpu: () => Promise.resolve(resposta('da gpu')),
    });
    expect(ok.camada).toBe('gpu');
    expect(gpt).not.toHaveBeenCalled();

    const caiu = await lerComGptPrimeiro({ gptPrimario: false, perguntarAoGpt: gpt, perguntarAGpu: gpuFora });
    expect(caiu.camada).toBe('openai_leitura_fallback_gpu');
  });

  it('tudo fora: devolve a falha real da GPU, sem fingir resposta', async () => {
    const r = await lerComGptPrimeiro({
      gptPrimario: true,
      perguntarAoGpt: () => Promise.resolve(null),
      perguntarAGpu: gpuFora,
    });
    expect(r.camada).toBe('gpu');
    expect(r.resposta.status).toBe('failed');
    expect(r.resposta.error).toBe('Ollama 502');
  });

  it('resposta em branco do GPT não conta como resposta', async () => {
    const r = await lerComGptPrimeiro({
      gptPrimario: true,
      perguntarAoGpt: () => Promise.resolve(resposta('   ')),
      perguntarAGpu: () => Promise.resolve(resposta('da gpu')),
    });
    expect(r.camada).toBe('gpu');
  });
});

describe('montarPromptDeLeitura', () => {
  it('separa a pergunta do contexto, com a pergunta antes', () => {
    const p = montarPromptDeLeitura('o que é esse sistema?', 'EQUIPE: Pedro, Tammy');
    expect(p.indexOf('PERGUNTA:\no que é esse sistema?')).toBeGreaterThan(-1);
    expect(p.indexOf('CONTEXTO:\nEQUIPE: Pedro, Tammy')).toBeGreaterThan(p.indexOf('PERGUNTA:'));
  });

  it('sem contexto, não deixa um bloco de CONTEXTO vazio', () => {
    expect(montarPromptDeLeitura('oi', undefined)).not.toContain('CONTEXTO:\n');
  });
});

describe('persona do Bento', () => {
  it('o módulo do worker é cópia exata de docs/agent-prompts/bento.md', async () => {
    const { readFileSync } = await import('node:fs');
    const { PERSONA_DO_BENTO } = await import('./bento-persona');
    const md = readFileSync(new URL('../../../../docs/agent-prompts/bento.md', import.meta.url), 'utf8');
    expect(PERSONA_DO_BENTO).toBe(md);
  });

  it('por padrão o prompt leva o manual completo e a ponte para o CONTEXTO', () => {
    const p = montarPromptDeLeitura('quem é você?', 'EQUIPE: Pedro', {});
    expect(p).toContain('Você é o Bento, a inteligência institucional da Agência Desigual.');
    expect(p).toContain('O "Vault" de que o manual fala, para você, é o bloco CONTEXTO');
    // O manual vem antes da pergunta, a pergunta antes do contexto.
    expect(p.indexOf('## 15. Regra final')).toBeLessThan(p.indexOf('PERGUNTA:'));
    expect(p.indexOf('PERGUNTA:')).toBeLessThan(p.indexOf('CONTEXTO:\nEQUIPE: Pedro'));
  });

  it('BENTO_PERSONA_COMPLETA=false volta ao cabeçalho curto', () => {
    const p = montarPromptDeLeitura('oi', undefined, { BENTO_PERSONA_COMPLETA: 'false' });
    expect(p).not.toContain('inteligência institucional');
    expect(p).toContain('Você é o Bento, o assistente de operação');
  });
});
