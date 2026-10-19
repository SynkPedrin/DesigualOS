import { describe, expect, it } from 'vitest';
import { planejarConsultas, semDuplicatas, type ConsultaDeWorkspace } from './routes';
import type { OperationTask } from '@desigual-os/tool-gateway';

/**
 * "TODAS AS TAREFAS" NUNCA SIGNIFICOU TODAS AS TAREFAS (defeito relatado em
 * 07/10/2026). As duas rotas agregadas da Central de Tasks consultavam só as
 * listas vinculadas a algum cliente — tarefa interna da agência, e tarefa de
 * cliente ainda sem vínculo (6 dos 58 clientes), não apareciam em lugar
 * nenhum. "Minhas tarefas" herdava o mesmo buraco.
 *
 * O que estes testes travam é a regra que substituiu aquilo, e os dois jeitos
 * de errá-la: consultar de menos (voltar ao recorte por lista na própria
 * agência) e consultar de mais (varrer o workspace de um cliente que a pessoa
 * apenas supervisiona, ou devolver a mesma tarefa duas vezes).
 */

const CHAVE_DA_CASA = { apiKey: 'pk_casa', teamId: '900' };
const CHAVE_DO_CLIENTE = { apiKey: 'pk_cliente', teamId: '901' };

const MINHA_ORG = 'org-propria';
const ORG_SUPERVISIONADA = 'org-cliente';

function consultaDe(consultas: ConsultaDeWorkspace[], teamId: string) {
  return consultas.find((c) => c.config.teamId === teamId);
}

describe('planejarConsultas — o que é meu vem inteiro, o que eu supervisiono vem recortado', () => {
  it('organização de que sou membro: workspace inteiro, sem filtro de lista', () => {
    const consultas = planejarConsultas(
      new Map([[MINHA_ORG, CHAVE_DA_CASA]]),
      new Map([[MINHA_ORG, ['lista-1', 'lista-2']]]),
      new Set([MINHA_ORG]),
    );

    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.listIds).toBeUndefined();
  });

  /**
   * O provedor enxerga a conta do cliente; isso é supervisão, não acesso
   * irrestrito ao workspace dele. Mesma régua de hierarquia-de-organizacao.ts:
   * leitura desce, e descer não vira acesso total.
   */
  it('organização que apenas enxergo: só as listas dos clientes dela', () => {
    const consultas = planejarConsultas(
      new Map([[ORG_SUPERVISIONADA, CHAVE_DO_CLIENTE]]),
      new Map([[ORG_SUPERVISIONADA, ['lista-do-cliente']]]),
      new Set([MINHA_ORG]),
    );

    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.listIds).toEqual(['lista-do-cliente']);
  });

  it('a agência sem nenhum cliente vinculado ainda consulta o workspace dela', () => {
    const consultas = planejarConsultas(new Map([[MINHA_ORG, CHAVE_DA_CASA]]), new Map(), new Set([MINHA_ORG]));

    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.listIds).toBeUndefined();
  });

  it('organização supervisionada sem lista nenhuma não vira consulta vazia', () => {
    const consultas = planejarConsultas(
      new Map([[ORG_SUPERVISIONADA, CHAVE_DO_CLIENTE]]),
      new Map(),
      new Set([MINHA_ORG]),
    );

    // Sem lista e sem direito ao workspace inteiro, não há o que perguntar —
    // e perguntar sem filtro traria o workspace inteiro, que é o que a regra
    // acima nega.
    expect(consultas).toHaveLength(0);
  });
});

describe('planejarConsultas — um workspace, uma consulta', () => {
  /**
   * O caso comum hoje: várias organizações caem na MESMA chave compartilhada.
   * Sem agrupar por workspace, o mesmo ClickUp era consultado N vezes e cada
   * tarefa aparecia N vezes na tela.
   */
  it('duas organizações na mesma credencial viram UMA consulta', () => {
    const consultas = planejarConsultas(
      new Map([
        [MINHA_ORG, CHAVE_DA_CASA],
        [ORG_SUPERVISIONADA, { ...CHAVE_DA_CASA }],
      ]),
      new Map([
        [MINHA_ORG, ['lista-1']],
        [ORG_SUPERVISIONADA, ['lista-2']],
      ]),
      new Set([MINHA_ORG]),
    );

    expect(consultas).toHaveLength(1);
  });

  /** A consulta mais ampla vence: um recorte por lista não pode esconder o
   *  que a consulta de workspace inteiro já traria. */
  it('mesmo workspace alcançado por membro E por supervisão: vale o inteiro', () => {
    const consultas = planejarConsultas(
      new Map([
        [ORG_SUPERVISIONADA, CHAVE_DA_CASA],
        [MINHA_ORG, { ...CHAVE_DA_CASA }],
      ]),
      new Map([[ORG_SUPERVISIONADA, ['lista-2']]]),
      new Set([MINHA_ORG]),
    );

    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.listIds).toBeUndefined();
  });

  it('workspaces diferentes continuam sendo duas consultas', () => {
    const consultas = planejarConsultas(
      new Map([
        [MINHA_ORG, CHAVE_DA_CASA],
        [ORG_SUPERVISIONADA, CHAVE_DO_CLIENTE],
      ]),
      new Map([[ORG_SUPERVISIONADA, ['lista-do-cliente']]]),
      new Set([MINHA_ORG]),
    );

    expect(consultas).toHaveLength(2);
    expect(consultaDe(consultas, '900')!.listIds).toBeUndefined();
    expect(consultaDe(consultas, '901')!.listIds).toEqual(['lista-do-cliente']);
  });

  it('duas organizações supervisionadas no mesmo workspace somam as listas', () => {
    const consultas = planejarConsultas(
      new Map([
        ['org-a', CHAVE_DO_CLIENTE],
        ['org-b', { ...CHAVE_DO_CLIENTE }],
      ]),
      new Map([
        ['org-a', ['lista-a']],
        ['org-b', ['lista-b']],
      ]),
      new Set([MINHA_ORG]),
    );

    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.listIds?.sort()).toEqual(['lista-a', 'lista-b']);
  });
});

describe('semDuplicatas', () => {
  const tarefa = (id: string) => ({ id, name: id }) as OperationTask;

  it('a mesma tarefa alcançada por dois caminhos conta uma vez', () => {
    expect(semDuplicatas([tarefa('1'), tarefa('2'), tarefa('1')]).map((t) => t.id)).toEqual(['1', '2']);
  });

  it('preserva a ordem da primeira aparição', () => {
    expect(semDuplicatas([tarefa('b'), tarefa('a'), tarefa('b')]).map((t) => t.id)).toEqual(['b', 'a']);
  });
});
