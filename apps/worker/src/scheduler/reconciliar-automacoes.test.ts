import { describe, expect, it } from 'vitest';
import { planejarReconciliacao, type AutomacaoLigada, type RepeatableRegistrado } from './reconciliar-automacoes';

/**
 * O CASO REAL que motivou esta função, medido em 09/10/2026 pela desigualos-f9:
 * a automação "ASDA" aparecia ATIVA na tela e com `next_run_at` nulo. O Redis
 * desta máquina tinha sido perdido e levado os repeatables junto; o Postgres
 * continuou dizendo `enabled = true`, e não havia caminho nenhum de volta.
 */
const ASDA: AutomacaoLigada = { id: 'a-asda', nome: 'ASDA', schedule: '0 8 * * *' };

describe('planejarReconciliacao', () => {
  it('o caso ASDA: ligada no banco, ausente no agendador, entra pra registrar', () => {
    const plano = planejarReconciliacao([ASDA], []);

    expect(plano.registrar).toEqual([ASDA]);
    expect(plano.remover).toEqual([]);
  });

  it('não mexe em nada quando os dois lados já concordam', () => {
    const plano = planejarReconciliacao([ASDA], [{ id: 'a-asda', pattern: '0 8 * * *' }]);

    expect(plano.registrar).toEqual([]);
    expect(plano.remover).toEqual([]);
  });

  /** O defeito de 03/09/2026, o mesmo visto do outro lado: sobrou repeatable. */
  it('repeatable sem automação ligada correspondente entra pra remover', () => {
    const plano = planejarReconciliacao([], [{ id: 'a-apagada', pattern: '*/5 * * * *' }]);

    expect(plano.registrar).toEqual([]);
    expect(plano.remover).toEqual([{ id: 'a-apagada', pattern: '*/5 * * * *' }]);
  });

  it('leva o pattern do registro junto, porque o BullMQ remove por {pattern, jobId}', () => {
    const plano = planejarReconciliacao([], [{ id: 'a-x', pattern: '30 7 * * 1' }]);

    expect(plano.remover[0]!.pattern).toBe('30 7 * * 1');
  });

  /**
   * Sem id não dá pra saber de quem o repeatable é. Apagar o que não se
   * identificou é pior que deixar sobrando: o órfão só desperdiça espaço, o
   * apagado errado desliga uma automação que alguém criou.
   */
  it('ignora repeatable sem id em vez de removê-lo', () => {
    const semId: RepeatableRegistrado[] = [{ id: null, pattern: '* * * * *' }, { id: undefined }];

    const plano = planejarReconciliacao([], semId);

    expect(plano.remover).toEqual([]);
  });

  it('resolve os dois sentidos na mesma passagem', () => {
    const plano = planejarReconciliacao(
      [ASDA, { id: 'a-ok', nome: 'Já agendada', schedule: '*/10 * * * *' }],
      [
        { id: 'a-ok', pattern: '*/10 * * * *' },
        { id: 'a-desligada', pattern: '0 0 * * *' },
      ],
    );

    expect(plano.registrar.map((a) => a.id)).toEqual(['a-asda']);
    expect(plano.remover.map((r) => r.id)).toEqual(['a-desligada']);
  });

  /**
   * Uma automação ligada DUAS vezes no agendador (resquício de troca de
   * schedule) não pode virar pedido de registro: ela está agendada, e
   * registrar de novo com outro pattern criaria um terceiro.
   */
  it('não pede registro para automação que já tem repeatable, mesmo duplicado', () => {
    const plano = planejarReconciliacao(
      [ASDA],
      [
        { id: 'a-asda', pattern: '0 8 * * *' },
        { id: 'a-asda', pattern: '0 9 * * *' },
      ],
    );

    expect(plano.registrar).toEqual([]);
  });
});
