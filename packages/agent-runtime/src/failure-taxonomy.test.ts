import { describe, expect, it } from 'vitest';
import { classificarFalha, ehFalhaDeInfraestrutura, mensagemDeFalhaDeInfra } from './failure-taxonomy';

/**
 * Regressão da avalanche medida em 16/09/2026: GPU ocupada -> chamada expira ->
 * o loop replaneja -> dispara outra chamada -> GPU mais congestionada. Cada
 * replan acrescentava carga na causa do problema.
 */
describe('classificarFalha', () => {
  it('reconhece o 502 real que o node do Bento devolveu', () => {
    expect(classificarFalha('Request failed with status 502 Bad Gateway')).toBe('INFERENCE_UPSTREAM_5XX');
  });

  it('reconhece o timeout real do fetch', () => {
    expect(classificarFalha('The operation was aborted due to timeout')).toBe('INFERENCE_CONNECTION_TIMEOUT');
    expect(classificarFalha('ClickUp não respondeu em 20s (timeout de rede)')).toBe('INFERENCE_GENERATION_TIMEOUT');
  });

  it('reconhece falha de conexão e de GPU', () => {
    expect(classificarFalha('fetch failed')).toBe('INFERENCE_CONNECTION_TIMEOUT');
    expect(classificarFalha("Agent 'otto' has no healthy node at dispatch time")).toBe('INFERENCE_GPU_UNAVAILABLE');
    expect(classificarFalha('CUDA out of memory')).toBe('INFERENCE_GPU_UNAVAILABLE');
  });

  it('resposta ruim do modelo continua COGNITIVA', () => {
    // Classificar falha cognitiva como infra esconderia defeito de verdade.
    expect(classificarFalha('resposta genérica reprovada pelo avaliador')).toBe('COGNITIVE');
    expect(classificarFalha('')).toBe('COGNITIVE');
    expect(classificarFalha(null)).toBe('COGNITIVE');
  });
});

describe('ehFalhaDeInfraestrutura', () => {
  it('só infra pula o replan', () => {
    expect(ehFalhaDeInfraestrutura('INFERENCE_UPSTREAM_5XX')).toBe(true);
    expect(ehFalhaDeInfraestrutura('INFERENCE_GPU_UNAVAILABLE')).toBe(true);
    expect(ehFalhaDeInfraestrutura('COGNITIVE')).toBe(false);
  });
});

describe('mensagemDeFalhaDeInfra', () => {
  it('não culpa a pergunta de quem perguntou', () => {
    // O erro antigo mandava "reformular a pergunta" quando a pergunta estava
    // perfeita e a GPU é que estava cheia.
    const m = mensagemDeFalhaDeInfra('INFERENCE_UPSTREAM_5XX');
    expect(m).toMatch(/sua pergunta está certa/i);
    expect(m).not.toMatch(/reformul/i);
  });

  it('diz o que houve, em português de gente', () => {
    expect(mensagemDeFalhaDeInfra('INFERENCE_GPU_UNAVAILABLE')).toMatch(/GPU/i);
    expect(mensagemDeFalhaDeInfra('INFERENCE_CONNECTION_TIMEOUT')).toMatch(/conexão/i);
  });
});

describe('capacidade', () => {
  it('reconhece a recusa do controle de admissão pelo marcador, não pelo 503', () => {
    expect(classificarFalha('Ollama 503: [INFERENCE_CAPACITY_TIMEOUT] fila da GPU cheia')).toBe(
      'INFERENCE_CAPACITY_TIMEOUT',
    );
  });

  it('503 sem marcador continua sendo falha de upstream', () => {
    expect(classificarFalha('Ollama 503 Service Unavailable')).toBe('INFERENCE_UPSTREAM_5XX');
  });

  it('recusa por capacidade é infraestrutura: não replaneja', () => {
    expect(ehFalhaDeInfraestrutura('INFERENCE_CAPACITY_TIMEOUT')).toBe(true);
  });

  it('a mensagem não culpa a pergunta de quem esperou', () => {
    const m = mensagemDeFalhaDeInfra('INFERENCE_CAPACITY_TIMEOUT');
    expect(m).toContain('Sua pergunta está certa');
    expect(m).not.toMatch(/reformul|tente outra pergunta/i);
  });
});

describe('agente ocupado', () => {
  it('recusa por fila do próprio agente é capacidade, não raciocínio', () => {
    expect(classificarFalha('ocupado respondendo outra pergunta, tenta em alguns segundos')).toBe(
      'INFERENCE_CAPACITY_TIMEOUT',
    );
  });

  it('e portanto não replaneja — replanejar contra fila é o que esgota o turno', () => {
    expect(ehFalhaDeInfraestrutura(classificarFalha('ocupado respondendo outra pergunta'))).toBe(true);
  });
});
