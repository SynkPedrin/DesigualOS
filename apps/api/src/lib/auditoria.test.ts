import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

/**
 * O HELPER CENTRAL DE AUDITORIA, travado:
 *
 *   - provider atuando num tenant que não é dele grava acting_as_provider
 *     (via tenantContext do requireTenant, ou via flag explícita das rotas
 *     que passam por podeConfigurar);
 *   - membro comum da casa NÃO grava a marca;
 *   - organization_id cai do tenantContext quando a rota não o passa — o
 *     insert manual do client.created não gravava, e o rastro ficava órfão
 *     de empresa.
 */

const insertValues: Array<Record<string, unknown>> = [];

vi.mock('@desigual-os/database', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertValues.push(v);
        return Promise.resolve(undefined);
      },
    }),
  },
  schema: { auditLogs: { id: 'audit.id' } },
}));

const { auditarAcao } = await import('./auditoria');

function fakeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    authUser: { id: 'user-1' },
    ...overrides,
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  insertValues.length = 0;
});

describe('auditarAcao', () => {
  it('provider dentro de empresa alheia (tenantContext.actingAsProvider) grava acting_as_provider', async () => {
    const request = fakeRequest({
      tenantContext: {
        userId: 'user-1',
        organizationId: 'org-cliente',
        membershipId: '',
        role: 'provedor',
        permissions: [],
        actingAsProvider: true,
      },
    });

    await auditarAcao(request, { action: 'client.created', clientId: 'client-1', metadata: { name: 'Cliente X' } });

    expect(insertValues[0]).toMatchObject({
      userId: 'user-1',
      organizationId: 'org-cliente',
      action: 'client.created',
      metadata: { name: 'Cliente X', acting_as_provider: true },
    });
  });

  it('membro da casa NÃO grava a marca, e o metadata vai como veio', async () => {
    const request = fakeRequest({
      tenantContext: {
        userId: 'user-1',
        organizationId: 'org-cliente',
        membershipId: 'vinculo-1',
        role: 'owner',
        permissions: [],
        actingAsProvider: false,
      },
    });

    await auditarAcao(request, { action: 'client.created', metadata: { name: 'Cliente X' } });

    expect(insertValues[0]).toMatchObject({ metadata: { name: 'Cliente X' } });
    expect((insertValues[0]?.metadata as Record<string, unknown>).acting_as_provider).toBeUndefined();
  });

  it('a flag explícita comoProvedor cobre as rotas sem requireTenant (connectors, membros)', async () => {
    const request = fakeRequest();

    await auditarAcao(request, { action: 'connector.configure', organizationId: 'org-1', metadata: { provider: 'clickup' }, comoProvedor: true });

    expect(insertValues[0]).toMatchObject({
      organizationId: 'org-1',
      metadata: { provider: 'clickup', acting_as_provider: true },
    });
  });
});
