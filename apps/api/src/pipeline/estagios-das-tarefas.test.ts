import { describe, expect, it } from 'vitest';
import { estagiosDasTarefas, juntarFluxos } from './estagios';

describe('estagiosDasTarefas — quando a lista não devolve status', () => {
  it('aberto primeiro, fechado por último, sem repetir', () => {
    expect(
      estagiosDasTarefas([
        { status: 'Concluído', statusType: 'closed' },
        { status: 'em produção', statusType: 'custom' },
        { status: 'a fazer', statusType: 'open' },
        { status: 'Em Produção', statusType: 'custom' },
        { status: 'revisão', statusType: 'custom' },
      ]).map((e) => e.status),
    ).toEqual(['a fazer', 'em produção', 'revisão', 'Concluído']);
  });
  it('task sem status não vira coluna', () => {
    expect(estagiosDasTarefas([{ status: null }, { status: '  ' }])).toEqual([]);
  });
});

describe('juntarFluxos — quadro "atribuídas a mim"', () => {
  const fluxoDaAgencia = [
    { status: 'aberto', type: 'open' },
    { status: 'aguardando aprovação', type: 'custom' },
    { status: 'alteração', type: 'custom' },
    { status: 'reprovado', type: 'custom' },
    { status: 'pronto', type: 'done' },
    { status: 'encerrado', type: 'closed' },
  ];
  it('as colunas são o fluxo da lista, mesmo sem tarefa nos status do meio (caso Jamile, 15/10/2026)', () => {
    const tarefasDela = [
      { status: 'aberto', type: 'open' },
      { status: 'pronto', type: 'done' },
    ];
    expect(juntarFluxos([fluxoDaAgencia, tarefasDela]).map((e) => e.status)).toEqual([
      'aberto',
      'aguardando aprovação',
      'alteração',
      'reprovado',
      'pronto',
      'encerrado',
    ]);
  });
  it('lista com fluxo diferente acrescenta só o que falta, no grupo certo', () => {
    const outra = [
      { status: 'to do', type: 'open' },
      { status: 'Aberto', type: 'open' },
      { status: 'complete', type: 'closed' },
    ];
    expect(juntarFluxos([fluxoDaAgencia, outra]).map((e) => e.status)).toEqual([
      'aberto',
      'to do',
      'aguardando aprovação',
      'alteração',
      'reprovado',
      'pronto',
      'encerrado',
      'complete',
    ]);
  });
});
