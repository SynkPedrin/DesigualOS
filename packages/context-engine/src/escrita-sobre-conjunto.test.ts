import { describe, expect, it } from 'vitest';
import { resolveOperationalScope } from './resolve-scope';

/**
 * "BENTO FINALIZE TODAS AS TASKS ATRIBUIDAS A PEDRO GABRIEL" — 08/10/2026,
 * com nove tarefas atrasadas visíveis na tela de Prioridades e o agente sem
 * nenhum dado do ClickUp no turno.
 *
 * `WRITE_ORDER_RE` suprimia a consulta ao vivo para toda ordem de escrita, com
 * a justificativa de que "quem manda criar não está pedindo panorama". Isso é
 * verdade para CRIAR — o alvo ainda não existe — e falso para AGIR sobre o que
 * existe: é impossível concluir tarefas que não se consegue enxergar.
 *
 * A supressão continua certa quando o alvo é preciso: aí a lista inteira não
 * acrescenta nada e a consulta é desperdício.
 */
const ve = async (frase: string) => {
  const s = await resolveOperationalScope(frase, new Date(), null);
  return s.operational;
};

describe('escrita sobre conjunto precisa da lista', () => {
  it.each([
    'finalize todas as tasks atribuidas a Pedro Gabriel',
    'BENTO FINALIZE TODAS AS TASKS ATRIBUIDAS A PEDRO GABRIEL',
    'conclui todas as minhas tarefas atrasadas',
    'marca como concluídas as tarefas de hoje',
    'move todas as pendentes pra revisão',
    'atribui todas as demandas abertas pra mim',
  ])('"%s" abre consulta ao ClickUp', async (frase) => {
    expect(await ve(frase)).toBe(true);
  });

  /** O outro lado: criar não precisa de lista, e continua sem gastar consulta. */
  it.each([
    'cria uma tarefa de revisão do carrossel',
    'abre um card pra gravar o reel',
    'cadastra a demanda nova da Elite',
  ])('"%s" continua sem consulta', async (frase) => {
    expect(await ve(frase)).toBe(false);
  });

  /**
   * Alvo PRECISO também continua sem consulta: o id já diz tudo, e puxar a
   * carteira inteira pra concluir uma tarefa nomeada é desperdício que o
   * usuário paga em espera.
   */
  it.each(['conclui essa daí', 'finaliza a segunda', 'fecha esse card'])(
    '"%s" (alvo preciso) continua sem consulta',
    async (frase) => {
      expect(await ve(frase)).toBe(false);
    },
  );
});
