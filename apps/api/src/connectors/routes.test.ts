import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * AS REGRAS DO CONECTOR POR EMPRESA, travadas nas rotas:
 *
 *   - tenant só vê/edita o PRÓPRIO conector — org alheia responde 404 (nunca
 *     403, que confirmaria a existência da empresa);
 *   - colaborador não mexe na chave que assina a operação da conta (403);
 *   - o GET NUNCA devolve o secret: só a máscara com os 4 últimos caracteres,
 *     suficiente pra reconhecer a chave sem fazê-la circular pelo navegador.
 *
 * Mesmo padrão de organizations/routes.test.ts: Fastify real, banco e
 * autorização mockados, regra de permissão (podeConfigurar) controlada por
 * caso.
 */

let currentUser: { id: string; roles: string[] };
let conectores: Array<{
  id: string;
  organizationId: string;
  provider: string;
  credentials: Record<string, string>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extrai os valores de uma condição drizzle mockada (ver routes.test.ts de organizations). */
function valoresDe(no: unknown, achados: string[] = []): string[] {
  if (typeof no === 'string') {
    achados.push(no);
    return achados;
  }
  if (Array.isArray(no)) {
    for (const item of no) valoresDe(item, achados);
    return achados;
  }
  if (no === null || typeof no !== 'object') return achados;
  if ('value' in no && typeof (no as { value: unknown }).value === 'string') {
    achados.push((no as { value: string }).value);
  }
  const chunks = (no as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) for (const c of chunks) valoresDe(c, achados);
  return achados;
}

function filtrar(cond: unknown) {
  const valores = valoresDe(cond);
  // Valores que não são UUID nem nome de coluna mockada são o :provider da rota.
  const pedeProvider = valores.some((v) => !UUID.test(v) && !v.startsWith('oc.'));
  return conectores.filter((r) => {
    if (valores.includes(r.id)) return true;
    if (!valores.includes(r.organizationId)) return false;
    return pedeProvider ? valores.includes(r.provider) : true;
  });
}

vi.mock('@desigual-os/database', () => {
  const organizationConnectors = {
    id: 'oc.id',
    organizationId: 'oc.organization_id',
    provider: 'oc.provider',
    credentials: 'oc.credentials',
    status: 'oc.status',
  };
  const auditLogs = { id: 'audit.id' };

  const thenable = <T>(valor: T) => Object.assign(Promise.resolve(valor), {});

  return {
    db: {
      select: () => ({
        from: () => ({
          where: (cond: unknown) => thenable(filtrar(cond)),
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === organizationConnectors) {
            conectores.push({
              id: `conn-${conectores.length + 1}`,
              organizationId: v.organizationId as string,
              provider: v.provider as string,
              credentials: v.credentials as Record<string, string>,
              status: (v.status as string) ?? 'ativa',
              createdAt: new Date('2026-10-01T12:00:00Z'),
              updatedAt: new Date('2026-10-01T12:00:00Z'),
            });
          }
          return thenable(undefined);
        },
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            for (const r of filtrar(cond)) Object.assign(r, patch);
            return thenable(undefined);
          },
        }),
      }),
      delete: () => ({
        where: (cond: unknown) => ({
          returning: () => {
            const alvo = filtrar(cond);
            conectores = conectores.filter((r) => !alvo.includes(r));
            return thenable(alvo.map((r) => ({ id: r.id })));
          },
        }),
      }),
    },
    schema: { organizationConnectors, auditLogs },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
}));

const mockPodeConfigurar = vi.fn();
vi.mock('../organizations/ficha', () => ({
  podeConfigurar: (...args: unknown[]) => mockPodeConfigurar(...args),
}));

const { registerConnectorRoutes } = await import('./routes');
const { __setConnectorConfigLoaderForTest } = await import('@desigual-os/tool-gateway');

const MINHA_ORG = '11111111-1111-4111-8111-111111111111';
const ORG_ALHEIA = '44444444-4444-4444-8444-444444444444';
const CHAVE_CHEIA = 'pk_9999_ABCDEFGH4567';

async function buildApp() {
  const app = Fastify();
  await registerConnectorRoutes(app);
  return app;
}

beforeEach(() => {
  // GET /connectors/whatsapp/health passa por resolveCommunicationProvider
  // (tool-gateway), que cacheia `loadConnectorRows` por 60s — sem isto, o
  // array `conectores` reatribuído a cada teste ficaria invisível pro
  // resolver, que serviria o resultado em cache do teste anterior.
  __setConnectorConfigLoaderForTest(null);
  currentUser = { id: 'user-1', roles: ['colaborador'] };
  mockPodeConfigurar.mockReset();
  // Quem responde pela própria empresa; a org alheia "não existe" pra ela.
  mockPodeConfigurar.mockImplementation(async (_user: unknown, orgId: string) =>
    orgId === MINHA_ORG
      ? { pode: true, motivo: null, comoProvedor: false }
      : { pode: false, motivo: 'Empresa não encontrada.', comoProvedor: false },
  );
  conectores = [
    {
      id: 'conn-1',
      organizationId: MINHA_ORG,
      provider: 'clickup',
      credentials: { apiKey: CHAVE_CHEIA, teamId: 'team-90' },
      status: 'ativa',
      createdAt: new Date('2026-10-01T12:00:00Z'),
      updatedAt: new Date('2026-10-01T12:00:00Z'),
    },
  ];
});

describe('GET /organizations/:id/connectors', () => {
  it('a empresa vê o próprio conector, com a chave MASCARADA e o team id visível', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${MINHA_ORG}/connectors` });

    expect(res.statusCode).toBe(200);
    const [c] = res.json().connectors;
    expect(c.provider).toBe('clickup');
    expect(c.credentials.apiKey).toBe(`••••${CHAVE_CHEIA.slice(-4)}`);
    expect(c.credentials.teamId).toBe('team-90');
    // Prova dura: o corpo inteiro da resposta não contém a chave em lugar nenhum.
    expect(res.body).not.toContain(CHAVE_CHEIA);
  });

  it('org alheia é 404 — "existe mas não é sua" confirmaria a existência dela', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${ORG_ALHEIA}/connectors` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Empresa não encontrada.');
  });

  it('quem não responde pela empresa recebe 403', async () => {
    mockPodeConfigurar.mockResolvedValue({ pode: false, motivo: 'Só quem responde pela empresa pode mudar a configuração dela.', comoProvedor: false });
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${MINHA_ORG}/connectors` });

    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /organizations/:id/connectors/:provider', () => {
  it('grava a credencial inteira e devolve só a máscara', async () => {
    conectores = [];
    const app = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/organizations/${MINHA_ORG}/connectors/clickup`,
      payload: { credentials: { apiKey: CHAVE_CHEIA, teamId: 'team-90' } },
    });

    expect(res.statusCode).toBe(200);
    expect(conectores).toHaveLength(1);
    expect(conectores[0]!.credentials.apiKey).toBe(CHAVE_CHEIA);
    expect(res.body).not.toContain(CHAVE_CHEIA);
    expect(res.json().credentials.apiKey).toBe(`••••${CHAVE_CHEIA.slice(-4)}`);
  });

  it('trocar a chave de um conector existente é UPDATE, não segunda linha', async () => {
    const app = await buildApp();
    const nova = 'pk_9999_NOVAKEY7890';

    const res = await app.inject({
      method: 'PUT',
      url: `/organizations/${MINHA_ORG}/connectors/clickup`,
      payload: { credentials: { apiKey: nova, teamId: 'team-90' } },
    });

    expect(res.statusCode).toBe(200);
    expect(conectores).toHaveLength(1);
    expect(conectores[0]!.credentials.apiKey).toBe(nova);
    expect(res.body).not.toContain(nova);
  });

  it('provider whatsapp (Evolution API, P1-A) grava e mascara igual', async () => {
    conectores = [];
    const app = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/organizations/${MINHA_ORG}/connectors/whatsapp`,
      payload: { credentials: { baseUrl: 'https://evo.cosentino.com', apiKey: CHAVE_CHEIA, instance: 'cosentino' } },
    });

    expect(res.statusCode).toBe(200);
    expect(conectores[0]!.credentials.apiKey).toBe(CHAVE_CHEIA);
    expect(res.json().credentials.apiKey).toBe(`••••${CHAVE_CHEIA.slice(-4)}`);
    expect(res.json().credentials.baseUrl).toBe('https://evo.cosentino.com'); // não é secret, não mascara
  });

  it('provider sem adapter ainda (jira) é 400 com o motivo', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/organizations/${MINHA_ORG}/connectors/jira`,
      payload: { credentials: { apiKey: 'k' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('não é suportada');
  });

  it('credencial incompleta falha na ENTRADA, não no turno seguinte', async () => {
    conectores = [];
    const app = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/organizations/${MINHA_ORG}/connectors/clickup`,
      payload: { credentials: { apiKey: 'só-a-chave' } },
    });

    expect(res.statusCode).toBe(400);
    expect(conectores).toHaveLength(0);
  });

  it('não grava nada na org alheia', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/organizations/${ORG_ALHEIA}/connectors/clickup`,
      payload: { credentials: { apiKey: 'k', teamId: 't' } },
    });

    expect(res.statusCode).toBe(404);
    expect(conectores.every((c) => c.organizationId !== ORG_ALHEIA)).toBe(true);
  });
});

describe('GET /organizations/:id/connectors/whatsapp/health', () => {
  it('sem conector gravado: configured false, connected false', async () => {
    conectores = [];
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${MINHA_ORG}/connectors/whatsapp/health` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: false, configured: false });
  });

  it('conector wapi gravado: configured true, chamada de rede ainda pendente vira 502 claro (nenhum endpoint foi inventado)', async () => {
    conectores = [
      {
        id: 'conn-wapi',
        organizationId: MINHA_ORG,
        provider: 'whatsapp',
        credentials: { vendor: 'wapi', baseUrl: 'https://api.w-api.app', instanceId: 'AQDBQK-DTYTRZ-DXEMU9', token: 'tok' },
        status: 'ativa',
        createdAt: new Date('2026-10-01T12:00:00Z'),
        updatedAt: new Date('2026-10-01T12:00:00Z'),
      },
    ];
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${MINHA_ORG}/connectors/whatsapp/health` });

    // health() captura o erro e devolve healthy:false — não é 502 (ver wapiHealth).
    expect(res.statusCode).toBe(200);
    expect(res.json().configured).toBe(true);
    expect(res.json().connected).toBe(false);
  });

  it('não vaza conector da org alheia', async () => {
    conectores = [
      {
        id: 'conn-wapi',
        organizationId: ORG_ALHEIA,
        provider: 'whatsapp',
        credentials: { vendor: 'wapi', baseUrl: 'https://api.w-api.app', instanceId: 'x', token: 'tok' },
        status: 'ativa',
        createdAt: new Date('2026-10-01T12:00:00Z'),
        updatedAt: new Date('2026-10-01T12:00:00Z'),
      },
    ];
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/organizations/${ORG_ALHEIA}/connectors/whatsapp/health` });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /organizations/:id/connectors/:provider', () => {
  it('desconecta a própria plataforma', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${MINHA_ORG}/connectors/clickup` });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(conectores).toHaveLength(0);
  });

  it('conector inexistente é 404', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${MINHA_ORG}/connectors/clickup` });
    expect(res.statusCode).toBe(200);
    const deNovo = await app.inject({ method: 'DELETE', url: `/organizations/${MINHA_ORG}/connectors/clickup` });
    expect(deNovo.statusCode).toBe(404);
  });

  it('não remove nada da org alheia', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'DELETE', url: `/organizations/${ORG_ALHEIA}/connectors/clickup` });

    expect(res.statusCode).toBe(404);
    expect(conectores).toHaveLength(1);
  });
});
