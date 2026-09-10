import { describe, expect, it } from 'vitest';
import { computeDedupeKey, relevanceRejection } from './memory-engine';

describe('relevanceRejection — filtro de relevância do pipeline de escrita', () => {
  it('descarta confirmação social (o exemplo que o dono deu: "beleza obrigado")', () => {
    for (const trivial of ['ok', 'beleza', 'valeu', 'obrigado', 'Obrigada!', 'blz', 'perfeito', 'entendi', 'combinado', 'sim', 'não']) {
      expect(relevanceRejection(trivial), trivial).toMatch(/confirmacao social/);
    }
  });

  it('descarta "kd?" e pontuação solta', () => {
    expect(relevanceRejection('kd?')).toBeTruthy();
    expect(relevanceRejection('???')).toBeTruthy();
  });

  it('descarta texto curto demais pra carregar fato', () => {
    expect(relevanceRejection('muda a cor')).toMatch(/curto demais/);
  });

  it('ACEITA o fato operacional real do exemplo do dono', () => {
    // "Cliente 3Net pediu para não utilizar linguagem extremamente técnica nos Reels."
    expect(
      relevanceRejection('Cliente 3Net pediu para não utilizar linguagem extremamente técnica nos Reels.'),
    ).toBeNull();
  });

  it('aceita preferência de cliente com contexto', () => {
    expect(relevanceRejection('A D. Carvalho aprova mais rápido quando o criativo vem com legenda pronta.')).toBeNull();
  });

  it('conteúdo vazio é descartado com motivo próprio', () => {
    expect(relevanceRejection('   ')).toMatch(/vazio/);
  });
});

describe('computeDedupeKey', () => {
  it('mesmo fato no mesmo escopo gera a mesma chave (dedup funciona)', () => {
    const a = computeDedupeKey({ kind: 'client.preference', content: 'Prefere linguagem simples', clientId: 'c1' });
    const b = computeDedupeKey({ kind: 'client.preference', content: 'prefere  LINGUAGEM simples!', clientId: 'c1' });
    expect(a).toBe(b);
  });

  it('mesmo texto em clientes diferentes NÃO colide (isolamento de cliente)', () => {
    const a = computeDedupeKey({ kind: 'client.preference', content: 'Prefere linguagem simples', clientId: 'c1' });
    const b = computeDedupeKey({ kind: 'client.preference', content: 'Prefere linguagem simples', clientId: 'c2' });
    expect(a).not.toBe(b);
  });

  it('fatos DIFERENTES sobre o mesmo assunto têm chaves diferentes (senão a supersessão nunca roda)', () => {
    // Este teste existe porque a primeira versão errou exatamente aqui: eu tinha incluído o
    // `subject` na chave de dedup, então "responsável mudou pra Maria" colidia com
    // "responsável é o João", o pipeline tratava como reconfirmação e a supersessão era
    // pulada — o fato anterior era sobrescrito em vez de aposentado, sem histórico. Chave é
    // do CONTEÚDO; quem cuida do assunto é a supersessão por subject.
    const antigo = computeDedupeKey({ kind: 'client.team', content: 'Responsável é o João', clientId: 'c1' });
    const novo = computeDedupeKey({ kind: 'client.team', content: 'Responsável mudou para a Maria', clientId: 'c1' });
    expect(antigo).not.toBe(novo);
  });

  it('kind diferente não colide', () => {
    const a = computeDedupeKey({ kind: 'client.preference', content: 'igual', clientId: 'c1' });
    const b = computeDedupeKey({ kind: 'client.rejection', content: 'igual', clientId: 'c1' });
    expect(a).not.toBe(b);
  });
});
