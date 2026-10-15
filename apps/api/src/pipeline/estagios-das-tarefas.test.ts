import { describe, expect, it } from 'vitest';
import { estagiosDasTarefas } from './estagios';

describe('estagiosDasTarefas — quando a lista não devolve status', () => {
  it('aberto primeiro, fechado por último, sem repetir', () => {
    expect(
      estagiosDasTarefas([
        { status: 'Concluído', statusType: 'closed' },
        { status: 'em produção', statusType: 'custom' },
        { status: 'a fazer', statusType: 'open' },
        { status: 'Em Produção', statusType: 'custom' },
        { status: 'revisão', statusType: 'custom' },
      ]),
    ).toEqual(['a fazer', 'em produção', 'revisão', 'Concluído']);
  });
  it('task sem status não vira coluna', () => {
    expect(estagiosDasTarefas([{ status: null }, { status: '  ' }])).toEqual([]);
  });
});
