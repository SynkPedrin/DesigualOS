import { describe, expect, it } from 'vitest';
import type { OperationTask } from '@desigual-os/tool-gateway';
import { apurarFrentes, blocoRelacional, diagnosticar, explicacaoParaPessoa, frenteDaTask, montarArvore } from './bento-arvore';

/**
 * A árvore usada aqui é a da D. Carvalho, lida do ClickUp em 29/09/2026. Se a
 * operação mudar de forma, estes testes quebram — é o que devem fazer.
 */

const HOJE = new Date(2026, 8, 29, 10, 0);
const dia = (n: number) => new Date(2026, 8, 29 + n).getTime();

function t(id: string, over: Partial<OperationTask> = {}): OperationTask {
  return {
    id, name: id, description: null, status: 'aberto', statusType: 'open',
    priority: null, url: null, dueDate: null, startDate: null, createdAt: null,
    updatedAt: HOJE.getTime(), assignees: [], tags: [], parentId: null,
    topLevelParentId: null, listId: 'L', listName: 'D. Carvalho',
    folderName: 'CLIENTES ATIVOS', spaceId: null, ...over,
  };
}

/** DC_Aprosoja, como está no workspace: mãe, etapas e peças. */
function aprosoja(): OperationTask[] {
  return [
    t('DC_Aprosoja'),
    t('DC_Aprosoja_Captação', { parentId: 'DC_Aprosoja', statusType: 'done', status: 'pronto' }),
    t('DC_Aprosoja_Roteiros', { parentId: 'DC_Aprosoja', statusType: 'done', status: 'pronto' }),
    t('DC_Aprosoja_Vídeo Painel de Led', { parentId: 'DC_Aprosoja', statusType: 'done', status: 'pronto' }),
    t('_Bases', { parentId: 'DC_Aprosoja_Vídeo Painel de Led', statusType: 'done', status: 'pronto', assignees: ['Gui'] }),
    t('_Edição', { parentId: 'DC_Aprosoja_Vídeo Painel de Led', statusType: 'done', status: 'pronto', assignees: ['Celso'] }),
    t('DC_Aprosoja_Edições', { parentId: 'DC_Aprosoja', assignees: ['Tammy'] }),
    ...Array.from({ length: 6 }, (_, i) =>
      t(`peca-${i}`, { parentId: 'DC_Aprosoja_Edições', assignees: ['Junior Antunes'], dueDate: dia(i - 2) }),
    ),
  ];
}

describe('a árvore é a relação que esta operação realmente mantém', () => {
  it('monta a hierarquia de três níveis', () => {
    const raizes = montarArvore(aprosoja());
    expect(raizes).toHaveLength(1);
    expect(raizes[0]!.task.id).toBe('DC_Aprosoja');
    const video = raizes[0]!.filhos.find((f) => f.task.id === 'DC_Aprosoja_Vídeo Painel de Led')!;
    expect(video.filhos.map((f) => f.task.id).sort()).toEqual(['_Bases', '_Edição']);
  });

  /**
   * 2 dos 21 pais da D. Carvalho não vieram na listagem. Derrubar a árvore
   * inteira por causa deles perderia as outras 19.
   */
  it('pai que não veio na listagem não derruba a árvore: o filho vira raiz', () => {
    const raizes = montarArvore([t('orfa', { parentId: 'nao-veio' }), ...aprosoja()]);
    expect(raizes.map((r) => r.task.id).sort()).toEqual(['DC_Aprosoja', 'orfa']);
  });

  it('tarefa solta não vira frente de uma peça só', () => {
    const f = apurarFrentes([...aprosoja(), t('avulsa')], HOJE);
    expect(f.map((x) => x.raiz.id)).toEqual(['DC_Aprosoja']);
  });

  it('a frente sabe o que já entregou, e isso muda a leitura do atraso', () => {
    const [f] = apurarFrentes(aprosoja(), HOJE);
    expect(f!.pecas).toHaveLength(13);
    expect(f!.prontas).toBe(5);
    expect(f!.donos[0]).toEqual({ pessoa: 'Junior Antunes', quantas: 6 });
  });

  it('responde a que frente uma peça pertence — "isso é parte de quê?"', () => {
    const frentes = apurarFrentes(aprosoja(), HOJE);
    expect(frenteDaTask('_Bases', frentes)?.raiz.id).toBe('DC_Aprosoja');
    expect(frenteDaTask('inexistente', frentes)).toBeNull();
  });
});

describe('a causa é apurada, nunca opinada', () => {
  it('concentração numa frente é UM problema, não sete', () => {
    const d = diagnosticar(aprosoja(), HOJE);
    expect(d.atrasadas).toBe(2);
    expect(d.causas[0]!.texto).toContain('mesma frente');
    expect(d.causas[0]!.texto).toContain('DC_Aprosoja');
  });

  /**
   * O "9 não são o problema" da régua da operação. Sem essa separação a pessoa
   * trata catorze coisas com a mesma urgência, que é o mesmo que não priorizar.
   */
  it('separa o que tem causa comum do que é cauda longa', () => {
    const d = diagnosticar(
      // Com dono, e donos DIFERENTES: senão elas caem na causa de "sem
      // responsável" ou na de pessoa única, e deixam de ser cauda longa.
      [
        ...aprosoja(),
        t('velha-1', { dueDate: dia(-200), assignees: ['Bruna'] }),
        t('velha-2', { dueDate: dia(-150), assignees: ['Stephany'] }),
      ],
      HOJE,
    );
    expect(d.atrasadas).toBe(4);
    expect(d.semPadrao).toBe(2);
  });

  it('pessoa que segura atraso em DUAS frentes vira causa própria', () => {
    const d = diagnosticar(
      [
        ...aprosoja(),
        t('OutraFrente'),
        t('of-1', { parentId: 'OutraFrente', assignees: ['Junior Antunes'], dueDate: dia(-3) }),
        t('of-2', { parentId: 'OutraFrente', assignees: ['Junior Antunes'], dueDate: dia(-4) }),
      ],
      HOJE,
    );
    expect(d.causas.some((c) => c.texto.includes('Junior Antunes') && c.texto.includes('frentes diferentes'))).toBe(true);
  });

  it('pessoa concentrada numa frente só NÃO vira causa nova — a frente já disse', () => {
    const d = diagnosticar(aprosoja(), HOJE);
    expect(d.causas.filter((c) => c.texto.includes('frentes diferentes'))).toHaveLength(0);
  });

  /** Misturar "parada na equipe" com "esperando o cliente" manda cobrar errado. */
  it('o que espera aprovação é separado do que é atraso da equipe', () => {
    const d = diagnosticar(
      [t('mae'), t('f1', { parentId: 'mae', dueDate: dia(-2), status: 'aguardando aprovação', assignees: ['Gui'] })],
      HOJE,
    );
    expect(d.causas.some((c) => c.texto.includes('aguardando aprovação'))).toBe(true);
    expect(d.causas.some((c) => c.texto.includes('não estão paradas na equipe'))).toBe(true);
  });

  it('atrasada sem dono é dita como tal: não vai andar sozinha', () => {
    const d = diagnosticar(
      [t('mae'), t('a', { parentId: 'mae', dueDate: dia(-1) }), t('b', { parentId: 'mae', dueDate: dia(-2) })],
      HOJE,
    );
    expect(d.causas.some((c) => c.texto.includes('não têm responsável'))).toBe(true);
  });

  it('cliente sem atraso não ganha causa inventada', () => {
    expect(diagnosticar([t('mae'), t('f', { parentId: 'mae', dueDate: dia(10) })], HOJE).causas).toEqual([]);
  });

  it('uma tarefa atrasada sozinha não é padrão', () => {
    const d = diagnosticar([t('mae'), t('f', { parentId: 'mae', dueDate: dia(-1), assignees: ['Gui'] })], HOJE);
    expect(d.causas).toEqual([]);
    expect(d.semPadrao).toBe(1);
  });
});

describe('o bloco manda responder pela causa, e proíbe o que não dá pra saber', () => {
  it('traz frente e causa, nessa ordem', () => {
    const b = blocoRelacional({ clientName: 'D. Carvalho', tasks: aprosoja(), agora: HOJE })!;
    expect(b.indexOf('ESTÁ ESTRUTURADA')).toBeLessThan(b.indexOf('POR QUE'));
    expect(b).toContain('5/13 peças prontas');
  });

  /**
   * dependencies veio 0 de 253 nos três maiores clientes. Deixar o modelo
   * deduzir precedência pelo nome produziria a frase mais perigosa possível:
   * a que parece raciocinada e ninguém confere.
   */
  it('proíbe afirmar dependência entre tarefas, porque o dado não existe', () => {
    const b = blocoRelacional({ clientName: 'D. Carvalho', tasks: aprosoja(), agora: HOJE })!;
    expect(b).toContain('não afirme que uma tarefa depende de');
    expect(b).toContain('a agência não registra dependência no ClickUp');
  });

  it('manda dizer o que NÃO é o problema', () => {
    const b = blocoRelacional({ clientName: 'D. Carvalho', tasks: aprosoja(), agora: HOJE })!;
    expect(b).toContain('o que NÃO é o problema');
  });

  it('cliente sem árvore e sem atraso não gera bloco', () => {
    expect(blocoRelacional({ clientName: 'X', tasks: [t('a'), t('b')], agora: HOJE })).toBeNull();
  });
});

/**
 * Na Cosentino real as causas somam 41 num cliente com 24 atrasadas: uma
 * tarefa sem dono dentro de uma frente concentrada conta nas duas. Sem aviso,
 * o modelo soma e inventa um total — exatamente o tipo de erro que custou a
 * credibilidade dos números antes.
 */
describe('causa que se sobrepõe não pode virar soma', () => {
  it('o bloco avisa que não se soma, e crava o total verdadeiro', () => {
    const tasks = [
      t('mae'),
      t('a', { parentId: 'mae', dueDate: dia(-1) }),
      t('b', { parentId: 'mae', dueDate: dia(-2) }),
      t('c', { parentId: 'mae', dueDate: dia(-3) }),
    ];
    const d = diagnosticar(tasks, HOJE);
    const soma = d.causas.reduce((s, c) => s + c.explica, 0);
    expect(soma).toBeGreaterThan(d.atrasadas);

    const b = blocoRelacional({ clientName: 'X', tasks, agora: HOJE })!;
    expect(b).toContain('as causas SE SOBREPÕEM');
    expect(b).toContain('nunca apresente um total diferente de 3');
  });

  it('uma avulsa sozinha é dita no singular', () => {
    const b = blocoRelacional({
      clientName: 'X',
      tasks: [t('mae'), t('a', { parentId: 'mae', dueDate: dia(-1) }), t('b', { parentId: 'mae', dueDate: dia(-2) }), t('solta', { dueDate: dia(-9), assignees: ['Gui'] })],
      agora: HOJE,
    })!;
    expect(b).toContain('1 é avulsa');
  });
});

/**
 * A análise precisa sair NO CHAT, não só no prompt. A primeira versão vivia só
 * no contexto e "o que está em risco na Cosentino?" foi capturada pelo caminho
 * do panorama, que responde antes — o bloco nunca chegou ao modelo e a resposta
 * voltou listando 25 tarefas.
 */
describe('a explicação escrita pra pessoa', () => {
  const comRisco = [
    t('mae'),
    t('a', { parentId: 'mae', dueDate: dia(-1) }),
    t('b', { parentId: 'mae', dueDate: dia(-2) }),
    t('c', { parentId: 'mae', dueDate: dia(-3) }),
    t('solta', { dueDate: dia(-90), assignees: ['Gui'] }),
  ];

  it('abre pelo que concentra o risco, não pela contagem', () => {
    const r = explicacaoParaPessoa({ clientName: 'Cosentino', tasks: comRisco, agora: HOJE })!;
    expect(r.split('\n')[0]).toContain('não pesam igual');
    expect(r).toContain('O que concentra o risco');
  });

  it('diz o que NÃO é o problema, que é o "9 não são o problema"', () => {
    const r = explicacaoParaPessoa({ clientName: 'Cosentino', tasks: comRisco, agora: HOJE })!;
    expect(r).toContain('avulsa');
  });

  it('não é instrução de prompt: nada de "não invente" na cara da pessoa', () => {
    const r = explicacaoParaPessoa({ clientName: 'Cosentino', tasks: comRisco, agora: HOJE })!;
    expect(r).not.toContain('NÃO invente');
    expect(r).not.toContain('ATENÇÃO:');
  });

  it('oferece a ação como pergunta — redistribuir sem pedir seria mexer na operação dos outros', () => {
    const r = explicacaoParaPessoa({ clientName: 'Cosentino', tasks: comRisco, agora: HOJE })!;
    expect(r).toContain('Se quiser, eu');
    expect(r).toContain('sem mexer no que está em aprovação');
  });

  it('cliente sem risco e sem árvore não gera texto', () => {
    expect(explicacaoParaPessoa({ clientName: 'X', tasks: [t('só')], agora: HOJE })).toBeNull();
  });
});
