import { describe, expect, it } from 'vitest';
import { estagioPeloStatus, statusInvalidosParaALista } from './estagios';
import type { PipelineStage } from '@desigual-os/types';

/**
 * STATUS É POR LISTA, NUNCA UNIVERSAL (13/10/2026, confirmado pela operação).
 * As duas funções puras aqui decidem (1) se um quadro pode ser salvo com os
 * status que tem, e (2) em que coluna uma task real cai — nenhuma delas toca
 * banco ou ClickUp, exatamente pra poder provar a regra sem precisar dos dois.
 */
describe('statusInvalidosParaALista', () => {
  const statusReaisDaLista = ['Aberto', 'Em produção', 'Fechado'];

  it('todo clickupStatus bate com a lista real: nada inválido', () => {
    const stages = [
      { id: 's1', label: 'Aberto', color: 'info' as const, clickupStatus: 'Aberto' },
      { id: 's2', label: 'Fechado', color: 'sinal' as const, clickupStatus: 'Fechado' },
    ];
    expect(statusInvalidosParaALista(stages, statusReaisDaLista)).toEqual([]);
  });

  it('comparação ignora caixa — "aberto" bate com "Aberto"', () => {
    const stages = [{ id: 's1', label: 'x', color: 'info' as const, clickupStatus: 'aberto' }];
    expect(statusInvalidosParaALista(stages, statusReaisDaLista)).toEqual([]);
  });

  it('status que não existe na lista real aparece na lista de inválidos', () => {
    const stages = [{ id: 's1', label: 'x', color: 'info' as const, clickupStatus: 'Cancelado' }];
    expect(statusInvalidosParaALista(stages, statusReaisDaLista)).toEqual(['Cancelado']);
  });

  it('coluna sem clickupStatus (cartão livre, não devia existir em quadro de tarefas, mas não quebra) é ignorada', () => {
    const stages = [{ id: 's1', label: 'x', color: 'info' as const, clickupStatus: undefined }];
    expect(statusInvalidosParaALista(stages, statusReaisDaLista)).toEqual([]);
  });
});

describe('estagioPeloStatus', () => {
  const stages: PipelineStage[] = [
    { id: 's1', label: 'Aberto', color: 'info', clickupStatus: 'Aberto' },
    { id: 's2', label: 'Em produção', color: 'aviso', clickupStatus: 'Em produção' },
  ];

  it('acha a coluna cujo clickupStatus bate com o status real da task', () => {
    expect(estagioPeloStatus(stages, 'Em produção')?.id).toBe('s2');
  });

  it('ignora caixa — o ClickUp nem sempre devolve a capitalização que foi configurada na coluna', () => {
    expect(estagioPeloStatus(stages, 'em PRODUÇÃO')?.id).toBe('s2');
  });

  it('status sem coluna correspondente devolve null — nunca inventa um encaixe', () => {
    expect(estagioPeloStatus(stages, 'Cancelado')).toBeNull();
  });

  it('status null (task sem status lido) devolve null', () => {
    expect(estagioPeloStatus(stages, null)).toBeNull();
  });
});
