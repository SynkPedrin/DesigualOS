import { describe, expect, it } from 'vitest';
import { matchAdAccountToClient, normalizarNomeMeta, type ClienteParaMatch } from './meta-sync';

/**
 * O auto-sync de contas Meta vincula POR NOME — um falso positivo aqui grava
 * vínculo errado em `client_meta_accounts` e o agente passa a ler mídia de um
 * cliente como se fosse de outro. Esta suíte trava a regra de confiança:
 * normalização agressiva, mas vínculo só com exatamente UM candidato.
 */

const clientes: ClienteParaMatch[] = [
  { id: 'c1', name: 'Cosentino' },
  { id: 'c2', name: 'Areia Branca' },
  { id: 'c3', name: 'Fácil Seguros' },
];

describe('normalizarNomeMeta', () => {
  it('tira diacríticos, minúsculas e pontuação', () => {
    expect(normalizarNomeMeta('Fácil Seguros — Ads!')).toBe('facil seguros');
  });

  it('remove termos genéricos que não distinguem conta nenhuma', () => {
    expect(normalizarNomeMeta('Conta de Anúncios Cosentino')).toBe('cosentino');
    expect(normalizarNomeMeta('Cosentino Ads - Tráfego Pago')).toBe('cosentino pago');
    expect(normalizarNomeMeta('Gestão de Mídia — Areia Branca')).toBe('de areia branca');
  });

  it('não come o meio do nome: termo genérico só sai como palavra inteira', () => {
    // "Madson" contém "ads" mas não É "ads".
    expect(normalizarNomeMeta('Madson')).toBe('madson');
  });

  it('nome vazio ou só de termos genéricos vira string vazia', () => {
    expect(normalizarNomeMeta('Ads')).toBe('');
    expect(normalizarNomeMeta('')).toBe('');
  });
});

describe('matchAdAccountToClient', () => {
  it('vincula por igualdade exata dos nomes normalizados', () => {
    const match = matchAdAccountToClient({ name: 'FÁCIL SEGUROS' }, clientes);
    expect(match).toEqual({ tipo: 'vincular', cliente: clientes[2] });
  });

  it('vincula quando um nome contém o outro (conta com sufixo genérico)', () => {
    const match = matchAdAccountToClient({ name: 'Cosentino — Conta de Anúncios' }, clientes);
    expect(match).toEqual({ tipo: 'vincular', cliente: clientes[0] });
  });

  it('vincula quando o nome da conta contém o do cliente com detalhe a mais', () => {
    const match = matchAdAccountToClient({ name: 'Areia Branca Resort 2026' }, [{ id: 'c2', name: 'Areia Branca' }]);
    expect(match).toEqual({ tipo: 'vincular', cliente: { id: 'c2', name: 'Areia Branca' } });
  });

  it('mais de um candidato é AMBÍGUO, nunca escolhido por ordem', () => {
    const dois = [
      { id: 'a', name: 'Areia Branca' },
      { id: 'b', name: 'Areia Branca Resort' },
    ];
    const match = matchAdAccountToClient({ name: 'Areia Branca Resort' }, dois);
    expect(match.tipo).toBe('ambigua');
    if (match.tipo === 'ambigua') expect(match.candidatos).toHaveLength(2);
  });

  it('sem candidato vira sem_match', () => {
    const match = matchAdAccountToClient({ name: 'Padaria do Bairro' }, clientes);
    expect(match).toEqual({ tipo: 'sem_match' });
  });

  it('conta sem nome (null) não casa com ninguém — null nunca vira string mágica', () => {
    const match = matchAdAccountToClient({ name: null }, clientes);
    expect(match).toEqual({ tipo: 'sem_match' });
  });
});
