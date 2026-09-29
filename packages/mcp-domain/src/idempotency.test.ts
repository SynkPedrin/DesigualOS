import { describe, expect, it } from 'vitest';
import {
  avaliarDuplicata, chaveDeIdempotencia, LIMIAR_IDENTICO, LIMIAR_SUSPEITO, normalizarTitulo, similaridade,
} from './idempotency';

describe('chaveDeIdempotencia — o mesmo pedido colide de propósito', () => {
  const base = { sessionId: 's1', tool: 'create_task', args: { clientId: 'c1', title: 'Carrossel' } };

  it('mesmo pedido, mesma chave', () => {
    expect(chaveDeIdempotencia(base)).toBe(chaveDeIdempotencia({ ...base }));
  });

  it('a ORDEM das chaves do argumento não muda a chave', () => {
    // Sem isto, o mesmo pedido serializado por outro caminho escaparia do dedup.
    const outraOrdem = { ...base, args: { title: 'Carrossel', clientId: 'c1' } };
    expect(chaveDeIdempotencia(outraOrdem)).toBe(chaveDeIdempotencia(base));
  });

  it('sessão diferente, chave diferente — um colega não herda o dedup do outro', () => {
    expect(chaveDeIdempotencia({ ...base, sessionId: 's2' })).not.toBe(chaveDeIdempotencia(base));
  });

  it('tool diferente, chave diferente', () => {
    expect(chaveDeIdempotencia({ ...base, tool: 'update_task' })).not.toBe(chaveDeIdempotencia(base));
  });

  it('argumento diferente, chave diferente', () => {
    expect(chaveDeIdempotencia({ ...base, args: { clientId: 'c1', title: 'Outro' } })).not.toBe(chaveDeIdempotencia(base));
  });
});

describe('similaridade — reordenação e acréscimo, que é o caso real', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizarTitulo('Criação de Carrossel — Envu!')).toBe('criacao de carrossel envu');
    expect(similaridade('Criação de Carrossel', 'criacao de carrossel')).toBe(1);
  });

  it('reordenar palavras não faz virar outra task', () => {
    expect(similaridade('Carrossel Outubro Envu', 'Envu carrossel outubro')).toBe(1);
  });

  it('títulos sem nada em comum ficam em zero', () => {
    expect(similaridade('Relatório de tráfego', 'Vídeo institucional')).toBe(0);
  });

  it('string vazia não quebra nem inventa semelhança', () => {
    expect(similaridade('', 'qualquer')).toBe(0);
    expect(similaridade('qualquer', '')).toBe(0);
  });
});

describe('avaliarDuplicata — o POSSIBLE_DUPLICATE que faltava (§13)', () => {
  const t = (id: string, title: string) => ({ id, title });

  it('sem nada parecido, cria', () => {
    expect(avaliarDuplicata('Carrossel de outubro', [t('1', 'Relatório mensal')]).decisao).toBe('CRIAR');
  });

  it('lista vazia cria', () => {
    expect(avaliarDuplicata('Qualquer coisa', []).decisao).toBe('CRIAR');
  });

  it('idêntico a menos de pontuação devolve o existente em vez de criar outro', () => {
    const r = avaliarDuplicata('Carrossel de Outubro — Envu', [t('9', 'carrossel de outubro envu')]);
    expect(r.decisao).toBe('JA_EXISTE');
    if (r.decisao === 'JA_EXISTE') expect(r.existente.id).toBe('9');
  });

  it('PARECIDO, MAS NÃO IGUAL, NÃO ESCOLHE SOZINHO — devolve os candidatos', () => {
    // É a regra que a auditoria forense cobrou: nunca criar duplicata em
    // silêncio, e nunca "adivinhar" qual das parecidas era a certa.
    const r = avaliarDuplicata('Carrossel de outubro', [
      t('1', 'Carrossel de outubro versão 2'),
      t('2', 'Carrossel de novembro'),
      t('3', 'Relatório de tráfego'),
    ]);
    expect(r.decisao).toBe('POSSIBLE_DUPLICATE');
    if (r.decisao === 'POSSIBLE_DUPLICATE') {
      expect(r.candidatos.map((c) => c.id)).toContain('1');
      expect(r.candidatos.map((c) => c.id)).not.toContain('3');
      expect(r.candidatos[0]!.similaridade).toBeGreaterThanOrEqual(LIMIAR_SUSPEITO);
    }
  });

  it('devolve no máximo 5 candidatos — a lista serve para decidir, não para ler', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => t(String(i), `Carrossel de outubro ${i}`));
    const r = avaliarDuplicata('Carrossel de outubro', muitos);
    if (r.decisao === 'POSSIBLE_DUPLICATE') expect(r.candidatos.length).toBeLessThanOrEqual(5);
    else throw new Error(`esperava POSSIBLE_DUPLICATE, veio ${r.decisao}`);
  });

  it('ordena por semelhança, do mais parecido para o menos', () => {
    const r = avaliarDuplicata('Carrossel de outubro Envu', [
      t('longe', 'Carrossel de outubro para outro cliente qualquer aqui'),
      t('perto', 'Carrossel de outubro Envu v2'),
    ]);
    if (r.decisao === 'POSSIBLE_DUPLICATE') expect(r.candidatos[0]!.id).toBe('perto');
  });

  it('os limiares estão na ordem certa — se invertidos, tudo vira duplicata', () => {
    expect(LIMIAR_IDENTICO).toBeGreaterThan(LIMIAR_SUSPEITO);
  });
});
