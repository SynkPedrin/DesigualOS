import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Pronto" (tipo `done`) NÃO é tarefa aberta, e nunca é atrasada.
 *
 * Medido ao vivo em 21/10/2026 no ClickUp da agência: das tarefas com prazo
 * vencido, 1.301 estavam "pronto"/"encerrado" e só 99 estavam de fato
 * atrasadas. O ClickUp, com include_closed=false, esconde só o tipo `closed`;
 * as de tipo `done` voltavam como abertas, e as ferramentas de operação do MCP,
 * que só comparam `prazo < agora`, contavam todas como atrasadas.
 */
const mocks = vi.hoisted(() => ({
  queryOperationTasks: vi.fn(),
  linhasDeClientes: [] as Array<{ id: string; name: string; listId: string | null }>,
}));

vi.mock('@desigual-os/database', () => {
  const consulta: Record<string, unknown> = {};
  const encadeavel: unknown = new Proxy(consulta, {
    get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(mocks.linhasDeClientes).then(ok) : () => encadeavel),
  });
  return {
    db: { select: () => encadeavel },
    schema: { clients: { id: 'id', name: 'name', clickupListId: 'clickup_list_id', organizationId: 'organization_id', deletedAt: 'deleted_at' } },
  };
});

vi.mock('@desigual-os/tool-gateway', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return { ...real, queryOperationTasks: mocks.queryOperationTasks };
});

const { ClickUpTaskProvider } = await import('./clickup-task-provider');

const UM_DIA = 86_400_000;
const vencida = Date.now() - 30 * UM_DIA;

function tarefa(id: string, status: string, statusType: string | null) {
  return {
    id, name: `Tarefa ${id}`, status, statusType, priority: null, dueDate: vencida, assignees: [],
    listId: 'lista-1', listName: 'Cosentino', url: `https://app.clickup.com/t/${id}`, updatedAt: Date.now(),
  };
}

function provider() {
  return new ClickUpTaskProvider({ config: {} as never, organizationId: 'org-1', seniorContext: {} as never });
}

beforeEach(() => {
  mocks.linhasDeClientes = [{ id: 'cli-1', name: 'Cosentino', listId: 'lista-1' }];
  mocks.queryOperationTasks.mockReset();
  mocks.queryOperationTasks.mockResolvedValue({
    tasks: [
      tarefa('a', 'aberto', 'open'),
      tarefa('b', 'aguardando aprovação', 'custom'),
      tarefa('c', 'pronto', 'done'),
      tarefa('d', 'encerrado', 'closed'),
      tarefa('e', 'pronto', 'done'),
    ],
    truncated: false,
  });
});

describe('searchTasks: só abertas é só abertas', () => {
  it('por padrão descarta pronto (done) e encerrado (closed)', async () => {
    const pagina = await provider().searchTasks({ limit: 100 });
    expect(pagina.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    // O que o panorama da operação faz com a página: prazo vencido entre as abertas.
    const atrasadas = pagina.tasks.filter((t) => t.dueDate !== null && t.dueDate < Date.now());
    expect(atrasadas).toHaveLength(2);
  });

  it('com includeClosed devolve todas, inclusive as concluídas', async () => {
    const pagina = await provider().searchTasks({ limit: 100, includeClosed: true });
    expect(pagina.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('status sem tipo (provedor que não informa) não é descartado por engano', async () => {
    mocks.queryOperationTasks.mockResolvedValue({ tasks: [tarefa('x', 'pronto', null)], truncated: false });
    const pagina = await provider().searchTasks({ limit: 100 });
    expect(pagina.tasks.map((t) => t.id)).toEqual(['x']);
  });

  it('o limite vale sobre as abertas, não sobre o que o ClickUp mandou', async () => {
    mocks.queryOperationTasks.mockResolvedValue({
      tasks: [...Array.from({ length: 6 }, (_, i) => tarefa(`d${i}`, 'pronto', 'done')), tarefa('aberta-1', 'aberto', 'open'), tarefa('aberta-2', 'aberto', 'open')],
      truncated: false,
    });
    const pagina = await provider().searchTasks({ limit: 2 });
    expect(pagina.tasks.map((t) => t.id)).toEqual(['aberta-1', 'aberta-2']);
    expect(pagina.nextCursor).toBeNull();
  });
});
