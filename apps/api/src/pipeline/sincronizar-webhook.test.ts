import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O LADO "CLICKUP MANDA, O QUADRO OBEDECE" (13/10/2026).
 *
 * `sincronizarCartaoDaTarefa` é chamado pelo webhook do ClickUp
 * (clickup/routes.ts, handleTaskChanged) depois que ele já resolveu o
 * cliente — aqui mockamos só as duas tabelas de pipeline, exatamente o que
 * esta função toca.
 */

const PIPELINE_BOARDS = { id: 'pb.id' };
const PIPELINE_CARDS = { id: 'pc.id' };
const CLIENTS = { id: 'c.id' };
let clientes: Array<{ id: string; organizationId: string; environment: string }> = [];

interface Quadro {
  id: string;
  tipo: string;
  clientId: string;
  stages: Array<{ id: string; label: string; color: string; clickupStatus?: string; categoria?: string }>;
  organizationId?: string;
  deletedAt: Date | null;
}

interface Cartao {
  id: string;
  boardId: string;
  stageId: string;
  name: string;
  clickupTaskId: string | null;
  deletedAt: Date | null;
}

let quadros: Quadro[];
let cartoes: Cartao[];
let proximoId = 0;
const inserts: Record<string, unknown>[] = [];
const updates: Array<{ id: string; set: Record<string, unknown> }> = [];

/** Extrai os literais de uma condição drizzle (mesma técnica de approvals/routes.test.ts). */
function coletarParams(no: unknown, achados: string[] = []): string[] {
  if (typeof no === 'string') {
    achados.push(no);
    return achados;
  }
  if (Array.isArray(no)) {
    for (const item of no) coletarParams(item, achados);
    return achados;
  }
  if (no === null || typeof no !== 'object') return achados;
  if ('value' in no && !Array.isArray((no as { value: unknown }).value)) {
    coletarParams((no as { value: unknown }).value, achados);
  }
  const chunks = (no as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) for (const c of chunks) coletarParams(c, achados);
  return achados;
}

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const params = coletarParams(cond);
          if (table === CLIENTS) {
            return Promise.resolve(clientes.filter((c) => params.includes(c.id)));
          }
          if (table === PIPELINE_BOARDS) {
            // Quadro geral (sem cliente) é buscado pela empresa; os demais, pelo cliente.
            return Promise.resolve(
              quadros.filter((q) => !q.deletedAt && (q.clientId ? params.includes(q.clientId) : params.includes((q as { organizationId?: string }).organizationId ?? ''))),
            );
          }
          if (table === PIPELINE_CARDS) {
            return Promise.resolve(cartoes.filter((c) => !c.deletedAt && params.includes(c.boardId) && params.includes(c.clickupTaskId ?? '')));
          }
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (table !== PIPELINE_CARDS) return Promise.resolve();
          inserts.push(v);
          cartoes.push({
            id: `card-${++proximoId}`,
            boardId: v.boardId as string,
            stageId: v.stageId as string,
            name: v.name as string,
            clickupTaskId: (v.clickupTaskId as string) ?? null,
            deletedAt: null,
          });
          return Promise.resolve();
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (valores: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table !== PIPELINE_CARDS) return Promise.resolve();
          const params = coletarParams(cond);
          for (const c of cartoes.filter((c) => params.includes(c.id))) {
            updates.push({ id: c.id, set: valores });
            if (valores.stageId !== undefined) c.stageId = valores.stageId as string;
            if (valores.deletedAt !== undefined) c.deletedAt = valores.deletedAt as Date;
          }
          return Promise.resolve();
        },
      }),
    }),
  },
  schema: { pipelineBoards: PIPELINE_BOARDS, pipelineCards: PIPELINE_CARDS, clients: CLIENTS },
}));

const QUADRO: Quadro = {
  id: 'board-1',
  tipo: 'tarefas',
  clientId: 'cliente-1',
  stages: [
    { id: 's-aberto', label: 'Aberto', color: 'info', clickupStatus: 'Aberto' },
    { id: 's-producao', label: 'Em produção', color: 'aviso', clickupStatus: 'Em produção' },
  ],
  deletedAt: null,
};

describe('sincronizarCartaoDaTarefa', () => {
  beforeEach(() => {
    quadros = [{ ...QUADRO, stages: [...QUADRO.stages] }];
    cartoes = [];
    clientes = [];
    proximoId = 0;
    inserts.length = 0;
    updates.length = 0;
  });

  it('taskCreated com status que bate com uma coluna: cria o cartão nela', async () => {
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskCreated', clientId: 'cliente-1', taskId: 'task-1', taskName: 'Carrossel de setembro', statusAtual: 'Aberto' });

    expect(cartoes).toHaveLength(1);
    expect(cartoes[0]).toMatchObject({ boardId: 'board-1', stageId: 's-aberto', name: 'Carrossel de setembro', clickupTaskId: 'task-1' });
  });

  it('taskCreated com status que NÃO bate com nenhuma coluna: não cria nada — a pessoa escolheu quais status viram coluna', async () => {
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskCreated', clientId: 'cliente-1', taskId: 'task-1', taskName: 'Tarefa qualquer', statusAtual: 'Arquivado' });

    expect(cartoes).toHaveLength(0);
  });

  it('taskCreated em cliente sem nenhum quadro de tarefas: não faz nada, não lança', async () => {
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskCreated', clientId: 'cliente-sem-quadro', taskId: 'task-1', taskName: 'X', statusAtual: 'Aberto' });

    expect(cartoes).toHaveLength(0);
  });

  it('taskUpdated com mudança de status reposiciona o cartão existente', async () => {
    cartoes.push({ id: 'card-1', boardId: 'board-1', stageId: 's-aberto', name: 'Carrossel', clickupTaskId: 'task-1', deletedAt: null });
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskUpdated', clientId: 'cliente-1', taskId: 'task-1', taskName: 'Carrossel', statusAtual: 'Em produção' });

    expect(cartoes[0]!.stageId).toBe('s-producao');
  });

  it('taskUpdated NUNCA cria cartão novo — isso é trabalho do backfill explícito (sincronizar-tarefas), não de um evento incidental', async () => {
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskUpdated', clientId: 'cliente-1', taskId: 'task-sem-cartao', taskName: 'X', statusAtual: 'Aberto' });

    expect(cartoes).toHaveLength(0);
  });

  it('taskUpdated pro mesmo status não gera update à toa', async () => {
    cartoes.push({ id: 'card-1', boardId: 'board-1', stageId: 's-aberto', name: 'Carrossel', clickupTaskId: 'task-1', deletedAt: null });
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskUpdated', clientId: 'cliente-1', taskId: 'task-1', taskName: 'Carrossel', statusAtual: 'Aberto' });

    expect(updates).toHaveLength(0);
  });

  it('taskDeleted apaga (soft delete) o cartão correspondente', async () => {
    cartoes.push({ id: 'card-1', boardId: 'board-1', stageId: 's-aberto', name: 'Carrossel', clickupTaskId: 'task-1', deletedAt: null });
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskDeleted', clientId: 'cliente-1', taskId: 'task-1', taskName: null, statusAtual: null });

    expect(cartoes[0]!.deletedAt).not.toBeNull();
  });

  it('taskDeleted sem cartão correspondente não lança', async () => {
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await expect(
      sincronizarCartaoDaTarefa({ evento: 'taskDeleted', clientId: 'cliente-1', taskId: 'task-fantasma', taskName: null, statusAtual: null }),
    ).resolves.toBeUndefined();
  });

  /**
   * O quadro geral da agência (15/10/2026): sem cliente e sem dono, colunas
   * por categoria. A tarefa do cliente entra nele pela categoria do status.
   */
  it('taskCreated também entra no quadro geral da agência, na categoria do status', async () => {
    clientes = [{ id: 'cliente-1', organizationId: 'org-1', environment: 'production' }];
    quadros.push({
      id: 'board-geral',
      tipo: 'tarefas',
      clientId: '',
      organizationId: 'org-1',
      stages: [
        { id: 'g-fazer', label: 'A fazer', color: 'info', categoria: 'a_fazer' },
        { id: 'g-aprov', label: 'Em aprovação', color: 'aviso', categoria: 'em_aprovacao' },
      ],
      deletedAt: null,
    } as Quadro);
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskCreated', clientId: 'cliente-1', taskId: 'task-9', taskName: 'Reels', statusAtual: 'aguardando aprovação' });

    expect(cartoes.find((c) => c.boardId === 'board-geral')?.stageId).toBe('g-aprov');
  });

  it('cliente de QA nunca entra no quadro geral', async () => {
    clientes = [{ id: 'cliente-1', organizationId: 'org-1', environment: 'qa' }];
    quadros.push({ id: 'board-geral', tipo: 'tarefas', clientId: '', organizationId: 'org-1', stages: [{ id: 'g-fazer', label: 'A fazer', color: 'info', categoria: 'a_fazer' }], deletedAt: null } as Quadro);
    const { sincronizarCartaoDaTarefa } = await import('./sincronizar-webhook.js');
    await sincronizarCartaoDaTarefa({ evento: 'taskCreated', clientId: 'cliente-1', taskId: 'task-9', taskName: 'Reels', statusAtual: 'aberto' });

    expect(cartoes.find((c) => c.boardId === 'board-geral')).toBeUndefined();
  });
});
