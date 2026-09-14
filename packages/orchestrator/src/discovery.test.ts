import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as DrizzleOrm from 'drizzle-orm';

/**
 * findHealthyNodeForAgent monta a query com `and(eq(agents.name, agent),
 * inArray(nodes.status, ['online', 'degraded']))` e deixa o Postgres
 * filtrar. Pra testar isso sem banco real, mockamos `eq`/`inArray`/`and` do
 * drizzle-orm pra devolverem descritores simples (em vez de SQL de verdade)
 * e o `db` fake aplica esses descritores como predicado JS contra um
 * fixture de nodes+agents - ou seja, o teste exercita a MESMA lógica de
 * filtro que a produção monta, não um resultado combinado à mão.
 *
 * Isso importa porque 'degraded' passou a ser aceito em 07/09/2026 (ver
 * comentário em discovery.ts): antes disso, um serviço auxiliar caindo
 * sozinho no Bento bloqueava o chat inteiro mesmo com o serviço crítico no
 * ar. Regressão aqui volta a travar despacho que deveria funcionar.
 */

interface ConditionDescriptor {
  __type: 'eq' | 'inArray' | 'and';
  column?: unknown;
  value?: unknown;
  values?: unknown;
  conditions?: ConditionDescriptor[];
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown): ConditionDescriptor => ({ __type: 'eq', column, value }),
    inArray: (column: unknown, values: unknown): ConditionDescriptor => ({ __type: 'inArray', column, values }),
    and: (...conditions: ConditionDescriptor[]): ConditionDescriptor => ({ __type: 'and', conditions }),
  };
});

const NODES_STATUS = 'nodes.status';
const AGENTS_NAME = 'agents.name';

interface FixtureRow {
  agentName: string;
  nodeId: string;
  privateHost: string;
  status: string;
}

let fixtureRows: FixtureRow[] = [];

function matches(row: FixtureRow, condition: ConditionDescriptor): boolean {
  if (condition.__type === 'and') {
    return (condition.conditions ?? []).every((c) => matches(row, c));
  }
  if (condition.__type === 'eq') {
    if (condition.column === AGENTS_NAME) return row.agentName === condition.value;
    return false;
  }
  if (condition.__type === 'inArray') {
    if (condition.column === NODES_STATUS) return (condition.values as string[]).includes(row.status);
    return false;
  }
  return false;
}

vi.mock('@desigual-os/database', () => ({
  db: {
    select: (_columns?: unknown) => ({
      from: (_table: unknown) => ({
        innerJoin: (_joinTable: unknown, _joinCond: unknown) => ({
          where: (condition: ConditionDescriptor) => ({
            // `.orderBy()` é só um passthrough aqui - os testes não têm
            // fixtures com duas linhas ambíguas pro MESMO agente (o cenário
            // real que a ordenação resolve, ver comentário em discovery.ts),
            // só precisa existir na cadeia pro código de produção rodar.
            orderBy: (..._columns: unknown[]) => ({
              limit: (n: number) =>
                Promise.resolve(
                  fixtureRows
                    .filter((row) => matches(row, condition))
                    .slice(0, n)
                    .map((row) => ({ nodeId: row.nodeId, privateHost: row.privateHost })),
                ),
            }),
          }),
        }),
      }),
    }),
  },
  schema: {
    nodes: {
      nodeId: 'nodes.nodeId',
      privateHost: 'nodes.privateHost',
      agentId: 'nodes.agentId',
      status: NODES_STATUS,
      lastHeartbeatAt: 'nodes.lastHeartbeatAt',
    },
    agents: { id: 'agents.id', name: AGENTS_NAME },
  },
}));

describe('findHealthyNodeForAgent', () => {
  afterEach(() => {
    fixtureRows = [];
  });

  it('retorna o node quando o status é online', async () => {
    fixtureRows = [{ agentName: 'bento', nodeId: 'NODE_BENTO', privateHost: '100.1.1.1', status: 'online' }];
    const { findHealthyNodeForAgent } = await import('./discovery.js');

    const result = await findHealthyNodeForAgent('bento');

    expect(result).toEqual({ nodeId: 'NODE_BENTO', privateHost: '100.1.1.1' });
  });

  it('TAMBÉM retorna o node quando o status é degraded (mudança de 07/09/2026 - não regredir)', async () => {
    fixtureRows = [{ agentName: 'bento', nodeId: 'NODE_BENTO', privateHost: '100.1.1.1', status: 'degraded' }];
    const { findHealthyNodeForAgent } = await import('./discovery.js');

    const result = await findHealthyNodeForAgent('bento');

    expect(result).toEqual({ nodeId: 'NODE_BENTO', privateHost: '100.1.1.1' });
  });

  it('NÃO retorna o node quando o status é offline', async () => {
    fixtureRows = [{ agentName: 'jarbas', nodeId: 'NODE_JARBAS', privateHost: '100.1.1.2', status: 'offline' }];
    const { findHealthyNodeForAgent } = await import('./discovery.js');

    const result = await findHealthyNodeForAgent('jarbas');

    expect(result).toBeNull();
  });

  it('devolve null quando não existe nenhum node pro agente pedido', async () => {
    fixtureRows = [{ agentName: 'suzy', nodeId: 'NODE_SUZY', privateHost: '100.1.1.3', status: 'online' }];
    const { findHealthyNodeForAgent } = await import('./discovery.js');

    const result = await findHealthyNodeForAgent('otto');

    expect(result).toBeNull();
  });

  it('ignora nodes offline de OUTRO agente e escolhe o node certo pro agente pedido', async () => {
    fixtureRows = [
      { agentName: 'bento', nodeId: 'NODE_BENTO_OFFLINE', privateHost: '100.1.1.1', status: 'offline' },
      { agentName: 'jarbas', nodeId: 'NODE_JARBAS_ONLINE', privateHost: '100.1.1.2', status: 'online' },
    ];
    const { findHealthyNodeForAgent } = await import('./discovery.js');

    const result = await findHealthyNodeForAgent('jarbas');

    expect(result).toEqual({ nodeId: 'NODE_JARBAS_ONLINE', privateHost: '100.1.1.2' });
  });
});
