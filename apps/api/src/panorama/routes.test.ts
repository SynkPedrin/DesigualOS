import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * GUARDA DE REGRESSÃO do vazamento de 05/10/2026 no painel da home: a CTE do
 * /panorama deixava `organization_id is null` entrar para QUALQUER conta —
 * dentro de um tenant, o panorama mostrava clientes, execuções, memórias e
 * sinais do legado inteiro da Desigual. Vazamento por AGREGAÇÃO continua
 * vazamento: o tamanho da operação do outro tenant já entrega carteira.
 *
 * A regra: recorte pela empresa de trabalho (server-side), e NULL só entra
 * quando a empresa de trabalho é a provedora.
 *
 * O `db.execute` é capturado e o SQL inspecionado — o que se afirma é a
 * consulta que VAI pro Postgres, não o JSON de saída.
 */

const DESIGUAL = '11111111-1111-1111-1111-111111111111';
const EMPRESA_QA = '22222222-2222-2222-2222-222222222222';

const state = vi.hoisted(() => ({
  user: { id: 'user-1', roles: ['master'], permissions: [] } as { id: string; roles: string[]; permissions: never[] },
  deTrabalho: null as { id: string; name: string; slug: string } | null,
  consultas: [] as unknown[],
}));

function dissecar(no: unknown, achados: { textos: string[]; valores: unknown[] } = { textos: [], valores: [] }) {
  if (typeof no === 'string') {
    achados.textos.push(no);
    return achados;
  }
  if (no === null || no === undefined || typeof no !== 'object') {
    if (typeof no === 'boolean') achados.valores.push(no);
    return achados;
  }
  if (Array.isArray(no)) {
    for (const item of no) dissecar(item, achados);
    return achados;
  }
  const registro = no as { value?: unknown; queryChunks?: unknown[] };
  if ('value' in registro) dissecar(registro.value, achados);
  if (Array.isArray(registro.queryChunks)) for (const c of registro.queryChunks) dissecar(c, achados);
  return achados;
}

vi.mock('@desigual-os/database', () => ({
  db: {
    execute: (consulta: unknown) => {
      state.consultas.push(consulta);
      return Promise.resolve([
        { clientes: [], serie: [], agentes: [], pessoas: 0, sem_clickup: 0, usando: 0, memorias: 0, sinais: 0 },
      ]);
    },
  },
  schema: {},
}));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = state.user;
  },
}));

vi.mock('../organizations/contexto', () => ({
  contextoCompletoDe: () =>
    Promise.resolve({
      escopo: { organizationIds: [], ehProvider: true },
      organizacoes: [],
      ativa: null,
      deTrabalho: state.deTrabalho
        ? { ...state.deTrabalho, marca: {}, eh_provedora: state.deTrabalho.id === DESIGUAL }
        : null,
    }),
}));

const app = Fastify();
const { registerPanoramaRoutes } = await import('./routes');
await app.register(registerPanoramaRoutes);
await app.ready();

describe('/panorama, recorte pela empresa de trabalho', () => {
  beforeEach(() => {
    state.consultas.length = 0;
    state.deTrabalho = null;
    process.env.PROVIDER_ORGANIZATION_ID = DESIGUAL;
  });

  it('dentro da Empresa QA, o legado NULL NÃO entra em nenhuma contagem', async () => {
    state.deTrabalho = { id: EMPRESA_QA, name: 'Empresa QA White Label', slug: 'qa' };
    const res = await app.inject({ method: 'GET', url: '/panorama' });
    expect(res.statusCode).toBe(200);

    expect(state.consultas.length).toBe(1);
    const { textos, valores } = dissecar(state.consultas[0]);
    const texto = textos.join(' ');

    // Toda perna de recorte aponta para a empresa de trabalho...
    expect(textos).toContain(EMPRESA_QA);
    expect(textos).not.toContain(DESIGUAL);
    // ...e o NULL vem travado em false em TODAS as cinco pernas (cli, exec_dia,
    // exec_agente, memorias, sinais). Antes da correção o NULL entrava
    // incondicionalmente — nenhum booleano existia na consulta.
    expect(valores.filter((v) => v === false).length).toBe(5);
    expect(valores).not.toContain(true);
    // A fronteira antiga (união de memberships via minhas_orgs) sumiu.
    expect(texto).not.toContain('minhas_orgs');
  });

  it('no contexto da provedora, o legado NULL entra', async () => {
    state.deTrabalho = { id: DESIGUAL, name: 'Desigual', slug: 'desigual' };
    const res = await app.inject({ method: 'GET', url: '/panorama' });
    expect(res.statusCode).toBe(200);

    const { textos, valores } = dissecar(state.consultas[0]);
    expect(textos).toContain(DESIGUAL);
    expect(valores.filter((v) => v === true).length).toBe(5);
  });

  it('sem empresa de trabalho resolvida, 403, nunca agrega sem recorte', async () => {
    const res = await app.inject({ method: 'GET', url: '/panorama' });
    expect(res.statusCode).toBe(403);
    expect(state.consultas.length).toBe(0);
  });
});
