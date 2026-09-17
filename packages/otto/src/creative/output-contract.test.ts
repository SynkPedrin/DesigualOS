import { describe, expect, it } from 'vitest';
import { contratoDeSaida, diretivaDoContrato } from './output-contract.js';

describe('three_titles_returns_three_titles', () => {
  it('lê o artefato e a quantidade do pedido', () => {
    expect(contratoDeSaida('Me dá 3 títulos para um carrossel dos 70 anos da Elite.')).toEqual({
      artefato: 'titulo',
      quantidade: 3,
    });
  });

  it('entende número por extenso, que é como a equipe fala', () => {
    expect(contratoDeSaida('me manda três títulos')).toEqual({ artefato: 'titulo', quantidade: 3 });
  });

  it('a diretiva exige a quantidade exata', () => {
    const d = diretivaDoContrato({ artefato: 'titulo', quantidade: 3 });
    expect(d).toMatch(/exatamente 3/);
  });
});

describe('three_headlines_does_not_return_captions', () => {
  it('headline é artefato próprio, não legenda', () => {
    expect(contratoDeSaida('escreve 3 headlines pro anúncio').artefato).toBe('headline');
  });

  it('a diretiva proíbe explicitamente devolver legenda ou post', () => {
    const d = diretivaDoContrato({ artefato: 'headline', quantidade: 3 });
    expect(d).toMatch(/NÃO devolva legenda/);
    expect(d).toMatch(/uma linha/i);
  });

  it('e diz que título não tem CTA nem hashtag — é o que o separa de legenda', () => {
    expect(diretivaDoContrato({ artefato: 'titulo', quantidade: 3 })).toMatch(/não tem CTA e não tem hashtag/i);
  });
});

describe('caption_request_returns_caption', () => {
  it('pedido de legenda continua sendo legenda', () => {
    expect(contratoDeSaida('escreve uma legenda de Instagram sobre seguro residencial').artefato).toBe('legenda');
  });

  it('e a forma final mantém a regra de colar', () => {
    const d = diretivaDoContrato({ artefato: 'legenda', quantidade: null });
    expect(d).toMatch(/hashtags na última linha/i);
    expect(d).toMatch(/CTA em bloco próprio/i);
  });
});

describe('script_request_returns_script', () => {
  it('roteiro é roteiro', () => {
    expect(contratoDeSaida('faz um roteiro de Reels de 20 segundos').artefato).toBe('roteiro');
  });

  it('roteiro ganha marcação de tempo, senão quem grava não executa', () => {
    expect(diretivaDoContrato({ artefato: 'roteiro', quantidade: null })).toMatch(/marcação de tempo/i);
  });

  it('roteiro vence "post" na mesma frase: o mais específico manda', () => {
    expect(contratoDeSaida('roteiro pro post de Reels').artefato).toBe('roteiro');
  });
});

describe('prompt_request_returns_prompt', () => {
  it('prompt de imagem é prompt', () => {
    expect(contratoDeSaida('me dá um prompt de imagem pra capa').artefato).toBe('prompt');
  });

  it('e sai pronto pra colar, sem explicação no meio', () => {
    expect(diretivaDoContrato({ artefato: 'prompt', quantidade: null })).toMatch(/pronto pra colar/i);
  });
});

describe('contrato ausente', () => {
  it('pergunta sem artefato não ganha diretiva: constranger formato que ninguém pediu troca um erro por outro', () => {
    expect(contratoDeSaida('qual é o tom de voz da Fácil Seguros?')).toEqual({
      artefato: 'indefinido',
      quantidade: null,
    });
    expect(diretivaDoContrato({ artefato: 'indefinido', quantidade: null })).toBe('');
  });

  it('pedido sem quantidade não inventa uma', () => {
    expect(contratoDeSaida('escreve um título').quantidade).toBe(1);
    expect(contratoDeSaida('escreve título pra peça').quantidade).toBeNull();
  });

  it('ignora acento: quem digita rápido não acentua', () => {
    expect(contratoDeSaida('me da 3 titulos').artefato).toBe('titulo');
  });
});
