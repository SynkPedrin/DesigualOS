import { describe, expect, it } from 'vitest';
import { observacoesProativas, observacoesDoPedido, proximoDiaUtil } from './bento-proatividade';
import type { TaskDetail } from '@desigual-os/tool-gateway';

/**
 * "Um pouco mais de proatividade" (pedido da operação, 28/09/2026).
 *
 * A leitura perigosa desse pedido seria deixar o agente completar o que falta
 * sozinho — escolher responsável, arrumar prazo. Isso é escrita não pedida, e é
 * o que o resto do sistema existe pra impedir. Aqui proatividade é dizer o que
 * já se vê, e OFERECER. Estes testes travam os dois lados: que ele fala, e que
 * ele não decide.
 */

const SEGUNDA = new Date(2026, 8, 28, 10, 0); // 28/09/2026 é segunda-feira

function task(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 't1', name: 'Task', status: 'aberto', priority: null,
    dueDate: new Date(2026, 8, 30).getTime(), startDate: null, timeEstimate: null,
    tags: [], checklists: [], watchers: [], listId: 'L1',
    assignees: [{ id: 1, username: 'Gui' }], description: '', attachments: [],
    ...over,
  };
}

describe('o que o Bento viu e não foi perguntado', () => {
  it('prazo já vencido é dito — é o de maior consequência', () => {
    const obs = observacoesProativas({ task: task({ dueDate: new Date(2026, 8, 20).getTime() }), agora: SEGUNDA });
    expect(obs[0]).toContain('já passou');
    expect(obs[0]).toContain('20/09');
  });

  it('prazo hoje NÃO é vencido', () => {
    const obs = observacoesProativas({ task: task({ dueDate: new Date(2026, 8, 28).getTime() }), agora: SEGUNDA });
    expect(obs.join(' ')).not.toContain('já passou');
  });

  it('prazo em fim de semana vira oferta, nunca correção automática', () => {
    const obs = observacoesProativas({ task: task({ dueDate: new Date(2026, 9, 3).getTime() }), agora: SEGUNDA }); // 03/10 = sábado
    expect(obs[0]).toContain('sábado');
    expect(obs[0]).toMatch(/quer que eu/i);
  });

  it('task sem responsável é o jeito mais comum de uma demanda sumir', () => {
    const obs = observacoesProativas({ task: task({ assignees: [] }), agora: SEGUNDA });
    expect(obs.join(' ')).toContain('sem responsável');
  });

  it('sem prazo só é dito quando não há nada mais grave', () => {
    expect(observacoesProativas({ task: task({ dueDate: null }), agora: SEGUNDA }).join(' ')).toContain('sem prazo');
    // com algo pior junto, o "sem prazo" cede o lugar
    const comPior = observacoesProativas({ task: task({ dueDate: null, assignees: [] }), agora: SEGUNDA });
    expect(comPior.join(' ')).toContain('sem responsável');
    expect(comPior.join(' ')).not.toContain('sem prazo');
  });

  it('task saudável não gera ruído — aviso demais é aviso ignorado', () => {
    expect(observacoesProativas({ task: task(), agora: SEGUNDA })).toEqual([]);
  });

  it('nunca mais de duas linhas', () => {
    const obs = observacoesProativas({ task: task({ dueDate: new Date(2026, 8, 1).getTime(), assignees: [] }), agora: SEGUNDA });
    expect(obs.length).toBeLessThanOrEqual(2);
  });

  it('sem task relida, não inventa observação', () => {
    expect(observacoesProativas({ task: null })).toEqual([]);
  });

  it('NENHUMA linha afirma ação executada', () => {
    const todas = [
      ...observacoesProativas({ task: task({ dueDate: new Date(2026, 8, 1).getTime(), assignees: [] }), agora: SEGUNDA }),
      ...observacoesProativas({ task: task({ dueDate: new Date(2026, 9, 3).getTime() }), agora: SEGUNDA }),
      ...observacoesDoPedido({ dueDateMs: new Date(2026, 8, 1).getTime(), removeuResponsavel: true, agora: SEGUNDA }),
    ];
    for (const linha of todas) expect(linha).not.toMatch(/\b(atribuí|ajustei|mudei|coloquei|corrigi|movi)\b/i);
  });
});

describe('observação a partir do PEDIDO (update, sem chamada extra)', () => {
  it('prazo pra trás avisa antes de a task virar atrasada', () => {
    const obs = observacoesDoPedido({ dueDateMs: new Date(2026, 8, 25).getTime(), agora: SEGUNDA });
    expect(obs[0]).toContain('anterior a hoje');
  });

  it('tirar o responsável avisa que a task ficou órfã', () => {
    expect(observacoesDoPedido({ removeuResponsavel: true, agora: SEGUNDA }).join(' ')).toContain('sem responsável');
  });

  it('pedido comum não gera observação nenhuma', () => {
    expect(observacoesDoPedido({ dueDateMs: new Date(2026, 8, 30).getTime(), agora: SEGUNDA })).toEqual([]);
  });
});

describe('próximo dia útil', () => {
  it('pula sábado e domingo; dia útil fica onde está', () => {
    const sabado = new Date(2026, 9, 3).getTime();
    expect(new Date(proximoDiaUtil(sabado)).getDay()).toBe(1);
    const terca = new Date(2026, 8, 29).getTime();
    expect(proximoDiaUtil(terca)).toBe(terca);
  });
});
