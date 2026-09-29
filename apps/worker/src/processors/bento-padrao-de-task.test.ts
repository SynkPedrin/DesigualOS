import { describe, expect, it } from 'vitest';
import type { OperationTask } from '@desigual-os/tool-gateway';
import { agruparEmFrentes, blocoDeFrentes, inferirConvencao, segmentar } from './bento-padrao-de-task';

/**
 * Os nomes usados aqui não são inventados: foram lidos do workspace real em
 * 29/09/2026 (411 tarefas abertas). Se a convenção da operação mudar, estes
 * testes quebram — e é exatamente o que devem fazer.
 */

const HOJE = new Date(2026, 8, 29, 10, 0);
const dia = (n: number) => new Date(2026, 8, 29 + n).getTime();

function task(nome: string, over: Partial<OperationTask> = {}): OperationTask {
  return {
    id: nome, name: nome, description: null, status: 'aberto', statusType: 'open',
    priority: null, url: null, dueDate: null, startDate: null, createdAt: null,
    updatedAt: HOJE.getTime(), assignees: [], tags: [], parentId: null, topLevelParentId: null, listId: 'L', listName: 'C',
    folderName: 'CLIENTES ATIVOS', spaceId: null, ...over,
  };
}

const D_CARVALHO = [
  'DC_Digitais Outubro/26_Dia do Engenheiro Agrícola',
  'DC_Digitais Outubro/26_Dia da Agricultura',
  'DC_Digitais Outubro/26_Dia Mundial da Alimentação',
  'DC_Digitais Outubro/26_Dia das Crianças',
  'DC_Aprosoja_Edições_O que mudou em 20 anos?',
  'DC_Aprosoja_Edições_A pior parte do plantio',
];

const TRES_NET = [
  '3Net - Edição Vídeo 12/10 - MOTION – Dia das Crianças',
  '3Net - Criação Layout bases 12/10 - MOTION – Dia das Crianças',
  '3Net - Materiais - OUTUBRO',
  '3Net - Materiais - SETEMBRO',
  '3Net - Criação de conteúdo - OUTUBRO',
];

describe('a convenção é observada, nunca assumida', () => {
  it('lê o padrão de underscore da D. Carvalho', () => {
    const c = inferirConvencao(D_CARVALHO)!;
    expect(c.separador).toBe('_');
    expect(c.prefixo).toBe('DC');
    expect(c.seguem).toBe(6);
  });

  it('lê o padrão de hífen da 3Net — separador diferente, mesma leitura', () => {
    const c = inferirConvencao(TRES_NET)!;
    expect(c.separador).toBe(' - ');
    expect(c.prefixo).toBe('3Net');
  });

  it('cliente com poucas tarefas não tem convenção — quatro nomes não são um padrão', () => {
    expect(inferirConvencao(['X_a', 'X_b', 'X_c'])).toBeNull();
  });

  it('nomes que não concordam entre si NÃO viram padrão inventado', () => {
    expect(
      inferirConvencao(['Ajustar o site', 'reunião com o cliente', 'Post do dia', 'orçamento de mídia', 'aprovar arte']),
    ).toBeNull();
  });

  it('a maioria manda: uma task fora do padrão não derruba a convenção', () => {
    const c = inferirConvencao([...D_CARVALHO, 'Criar Cosentino_Europa V — Cosentino'])!;
    expect(c.prefixo).toBe('DC');
  });

  it('os exemplos são nomes REAIS da equipe, não descrição do formato', () => {
    expect(inferirConvencao(D_CARVALHO)!.exemplos[0]).toBe('DC_Digitais Outubro/26_Dia do Engenheiro Agrícola');
  });
});

describe('segmentar respeita o separador do cliente', () => {
  it('quebra por underscore', () => {
    expect(segmentar('DC_Aprosoja_Edições_A pior parte', '_')).toEqual(['DC', 'Aprosoja', 'Edições', 'A pior parte']);
  });

  it('nome sem o separador é um segmento só — não força hierarquia', () => {
    expect(segmentar('Briefing de campanha Outubro Rosa', '_')).toEqual(['Briefing de campanha Outubro Rosa']);
  });
});

describe('frente é o que a pasta do ClickUp deveria dar e não dá', () => {
  const tasks = D_CARVALHO.map((n) => task(n));
  const c = inferirConvencao(D_CARVALHO)!;

  it('tarefas com o mesmo prefixo são a mesma entrega', () => {
    const f = agruparEmFrentes(tasks, c, HOJE);
    expect(f.find((x) => x.nome === 'DC_Digitais Outubro/26')?.quantas).toBe(4);
    expect(f.find((x) => x.nome === 'DC_Aprosoja_Edições')?.quantas).toBe(2);
  });

  it('a frente é o prefixo MAIS específico — parar em "DC" repetiria o nome do cliente', () => {
    expect(agruparEmFrentes(tasks, c, HOJE).some((f) => f.nome === 'DC')).toBe(false);
  });

  it('tarefa avulsa não vira frente de uma linha', () => {
    const f = agruparEmFrentes([...tasks, task('DC_Solta_Peça única')], c, HOJE);
    expect(f.every((x) => x.quantas >= 2)).toBe(true);
  });

  it('a frente carrega atraso e falta de dono — é o que faz alguém agir', () => {
    const comRisco = [
      task('DC_Digitais Outubro/26_A', { dueDate: dia(-3), assignees: ['Gui'] }),
      task('DC_Digitais Outubro/26_B', { dueDate: dia(-1), assignees: [] }),
      task('DC_Digitais Outubro/26_C', { dueDate: dia(5), assignees: ['Gui'] }),
    ];
    const f = agruparEmFrentes(comRisco, c, HOJE)[0]!;
    expect(f.atrasadas).toBe(2);
    expect(f.semDono).toBe(1);
    expect(f.donos).toEqual(['Gui']);
  });

  it('frente com mais atraso vem primeiro — a ordem é a do risco', () => {
    const f = agruparEmFrentes(
      [
        task('DC_Calma_1'), task('DC_Calma_2'), task('DC_Calma_3'),
        task('DC_Fogo_1', { dueDate: dia(-2) }), task('DC_Fogo_2', { dueDate: dia(-2) }),
      ],
      c,
      HOJE,
    );
    expect(f[0]!.nome).toBe('DC_Fogo');
  });
});

describe('o bloco ensina a nomear antes de listar', () => {
  const tasks = D_CARVALHO.map((n) => task(n, { listName: 'D. Carvalho' }));

  /**
   * O bloco deixou de listar frentes em 29/09/2026: a árvore de subtarefa
   * (bento-arvore.ts) é a autoridade sobre agrupamento, e duas definições de
   * "frente" no mesmo prompt faziam o modelo citar agrupamento que a árvore não
   * confirma. Aqui ficou só o que a árvore não sabe: como se escreve o nome.
   */
  it('traz a convenção e proíbe o vício das tasks que o próprio Bento criou', () => {
    const b = blocoDeFrentes({ clientName: 'D. Carvalho', tasks, agora: HOJE })!;
    expect(b).toContain('Prefixo "DC"');
    // No workspace real existem "Criar Cosentino_... — Cosentino": dá pra ver a
    // olho nu qual task é da equipe e qual é do robô.
    expect(b).toContain('Nada de verbo na frente');
  });

  it('cliente sem convenção não ganha bloco — melhor nada que padrão inventado', () => {
    const soltas = ['Ajustar o site', 'reunião', 'Post do dia', 'orçamento', 'aprovar arte'].map((n) => task(n));
    expect(blocoDeFrentes({ clientName: 'X', tasks: soltas, agora: HOJE })).toBeNull();
  });

  it('tarefa entregue não conta na frente nem na convenção', () => {
    const b = blocoDeFrentes({
      clientName: 'D. Carvalho',
      tasks: [...tasks, ...Array.from({ length: 30 }, (_, i) => task(`entregue ${i}`, { statusType: 'done' }))],
      agora: HOJE,
    })!;
    expect(b).toContain('em 6 de 6 tarefas abertas');
  });

});
