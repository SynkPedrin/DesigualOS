import { describe, expect, it } from 'vitest';
import type { OperationTask } from '@desigual-os/tool-gateway';
import { inicioDoDia, tarefasPorPessoa } from './tarefas';

// 21/10/2026 15:00 em Brasília (18:00 UTC)
const agora = Date.parse('2026-10-21T18:00:00Z');
const H = 60 * 60_000;

function t(extra: Partial<OperationTask>): OperationTask {
  return {
    id: Math.random().toString(36).slice(2), name: 'Tarefa', description: null, status: 'aberto', statusType: 'open', priority: null, url: null,
    dueDate: null, startDate: null, createdAt: null, updatedAt: agora - H, assignees: [], assigneeIds: [], assigneeEmails: [], assigneeAvatars: [],
    tags: [], parentId: null, topLevelParentId: null, listId: 'l1', listName: 'Lista', folderName: null, spaceId: null,
    ...extra,
  } as OperationTask;
}

const pessoas = [
  { id: 'alicia', emails: ['alicia@agencia.com'] },
  // ClickUp com outro e-mail, vinculado no perfil
  { id: 'matheus', emails: ['sain@agencia.com', 'matheus.clickup@gmail.com'] },
];
const cliente = () => ({ id: 'c1', name: 'Café Aurora' });

describe('tarefas por pessoa', () => {
  it('conta abertas, atrasadas, hoje e semana; concluída (pronto/encerrado) nunca é atrasada', () => {
    const tarefas = [
      t({ assigneeEmails: ['alicia@agencia.com'], dueDate: agora - 26 * H }), // atrasada desde ontem
      t({ assigneeEmails: ['alicia@agencia.com'], dueDate: agora + 2 * H }), // vence hoje (17h)
      t({ assigneeEmails: ['alicia@agencia.com'], dueDate: agora + 3 * 24 * H }), // na semana
      t({ assigneeEmails: ['alicia@agencia.com'], dueDate: agora - 50 * H, status: 'pronto', statusType: 'done' }), // concluída
      t({ assigneeEmails: ['alicia@agencia.com'], dueDate: agora - 50 * H, status: 'encerrado', statusType: 'closed' }), // concluída
      t({ assigneeEmails: ['alicia@agencia.com'] }), // sem prazo
    ];
    const r = tarefasPorPessoa(tarefas, pessoas, cliente, agora).porPessoa.get('alicia')!;
    expect(r).toMatchObject({ abertas: 4, atrasadas: 1, vencem_hoje: 1, vencem_na_semana: 2, sem_prazo: 1, concluidas_7d: 2 });
    expect(r.lista[0]!.atrasada).toBe(true);
  });

  it('casa pelo e-mail do ClickUp vinculado; tarefa de duas pessoas conta para as duas', () => {
    const tarefas = [t({ assigneeEmails: ['matheus.clickup@gmail.com', 'alicia@agencia.com'] })];
    const { porPessoa } = tarefasPorPessoa(tarefas, pessoas, cliente, agora);
    expect(porPessoa.get('matheus')!.abertas).toBe(1);
    expect(porPessoa.get('alicia')!.abertas).toBe(1);
  });

  it('"o que está fazendo": em andamento primeiro (a mais recente), depois atrasadas; no máximo 3', () => {
    const tarefas = [
      t({ name: 'atrasada', assigneeEmails: ['alicia@agencia.com'], dueDate: agora - 5 * H }),
      t({ name: 'alteração recente', status: 'alteração', statusType: 'custom', assigneeEmails: ['alicia@agencia.com'], updatedAt: agora - 1000 }),
      t({ name: 'aguardando antiga', status: 'aguardando aprovação', statusType: 'custom', assigneeEmails: ['alicia@agencia.com'], updatedAt: agora - 9 * H }),
      t({ name: 'aberta qualquer', assigneeEmails: ['alicia@agencia.com'] }),
    ];
    const r = tarefasPorPessoa(tarefas, pessoas, cliente, agora).porPessoa.get('alicia')!;
    expect(r.agora.map((x) => x.name)).toEqual(['alteração recente', 'aguardando antiga', 'atrasada']);
    expect(r.em_andamento).toBe(2);
  });

  it('sem responsável é contado à parte; de quem não é da equipe não entra em ninguém', () => {
    const tarefas = [t({ dueDate: agora - H }), t({}), t({ assigneeEmails: ['outra@pessoa.com'] })];
    const r = tarefasPorPessoa(tarefas, pessoas, cliente, agora);
    expect(r.semResponsavel).toBe(2);
    expect(r.semResponsavelAtrasadas).toBe(1);
    expect(r.porPessoa.get('alicia')!.abertas).toBe(0);
  });

  it('concluídas nos últimos 7 dias contam como entrega', () => {
    const tarefas = [
      t({ assigneeEmails: ['alicia@agencia.com'], status: 'pronto', statusType: 'done', updatedAt: agora - 2 * 24 * H }),
      t({ assigneeEmails: ['alicia@agencia.com'], status: 'pronto', statusType: 'done', updatedAt: agora - 10 * 24 * H }),
    ];
    expect(tarefasPorPessoa(tarefas, pessoas, cliente, agora).porPessoa.get('alicia')!.concluidas_7d).toBe(1);
  });

  it('o dia é o de Brasília: 23h de Brasília ainda é hoje', () => {
    const inicio = inicioDoDia(Date.parse('2026-10-22T01:30:00Z')); // 22h30 do dia 21 em Brasília
    expect(new Date(inicio).toISOString()).toBe('2026-10-21T03:00:00.000Z');
  });
});
