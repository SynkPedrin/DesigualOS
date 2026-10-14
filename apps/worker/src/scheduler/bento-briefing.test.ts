import { describe, expect, it } from 'vitest';
import { montarBriefing, type TarefaDoBriefing } from './bento-briefing';

// 14/10/2026, 10h em São Paulo.
const AGORA = new Date('2026-10-14T13:00:00.000Z');
const HOJE_12H = new Date('2026-10-14T15:00:00.000Z').getTime();
const ONTEM = new Date('2026-10-13T15:00:00.000Z').getTime();
const DEPOIS_DE_AMANHA = new Date('2026-10-16T15:00:00.000Z').getTime();
const CLIENTES = new Map([['L1', 'Alfa'], ['L2', 'Gama']]);

const t = (over: Partial<TarefaDoBriefing>): TarefaDoBriefing => ({
  id: 'x',
  name: 'Tarefa',
  statusType: 'open',
  priority: 'normal',
  dueDate: HOJE_12H,
  assignees: ['Ana'],
  assigneeEmails: ['ana@x.com'],
  listId: 'L1',
  ...over,
});
const ana = { userId: 'u1', nome: 'Ana', email: 'ana@x.com', gestor: false };
const gestor = { userId: 'u2', nome: 'Bruno', email: 'bruno@x.com', gestor: true };

describe('montarBriefing', () => {
  it('colaboradora: atrasadas, hoje e próximos dias, só as dela', () => {
    const b = montarBriefing(
      ana,
      [
        t({ name: 'Atrasada', dueDate: ONTEM, priority: 'high' }),
        t({ name: 'De hoje' }),
        t({ name: 'Depois', dueDate: DEPOIS_DE_AMANHA }),
        t({ name: 'Do Bruno', assignees: ['Bruno'], assigneeEmails: ['bruno@x.com'], dueDate: ONTEM }),
      ],
      CLIENTES,
      AGORA,
    )!;
    expect(b.title).toBe('Bom dia: 1 atrasada(s) sua(s) e 1 para hoje');
    expect(b.body).toContain('Atrasada (Alfa) ⚠️');
    expect(b.body).toContain('Vencem hoje (1)');
    expect(b.body).toContain('Próximos dias (1)');
    expect(b.body).not.toContain('Do Bruno');
    expect(b.body).not.toContain('Equipe:');
  });
  it('concluída não aparece', () => {
    expect(montarBriefing(ana, [t({ statusType: 'closed', dueDate: ONTEM })], CLIENTES, AGORA)).toBeNull();
  });
  it('nada a dizer = nenhum aviso (não manda "bom dia" vazio)', () => {
    expect(montarBriefing(ana, [], CLIENTES, AGORA)).toBeNull();
  });
  it('gestão: atrasadas por pessoa, clientes com atraso e sem dono, com números contados', () => {
    const b = montarBriefing(
      gestor,
      [
        t({ dueDate: ONTEM }),
        t({ dueDate: ONTEM, listId: 'L2' }),
        t({ dueDate: ONTEM, assignees: ['Carla'], assigneeEmails: ['c@x.com'] }),
        t({ assignees: [], assigneeEmails: [] }),
      ],
      CLIENTES,
      AGORA,
    )!;
    expect(b.body).toContain('Atrasadas na equipe: 3 (Ana 2 · Carla 1)');
    expect(b.body).toContain('Clientes com mais atraso: Alfa 2 · Gama 1');
    expect(b.body).toContain('Sem responsável: 1');
  });
});
