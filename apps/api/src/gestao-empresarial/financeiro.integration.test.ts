import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gestão Empresarial contra um Postgres de verdade (LOCAL).
 *
 * Roda só com `GESTAO_TEST_DATABASE_URL` apontando para o banco local já migrado, e SÓ ele:
 * nunca use a URL de produção. A autenticação é simulada por cabeçalho; tudo o mais (SQL,
 * transações, constraints, razão) é real. Cada execução cria as próprias organizações e as remove.
 */
const url = process.env.GESTAO_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
else process.env.DATABASE_URL ??= 'postgres://t:t@127.0.0.1:1/t';
process.env.GESTAO_EMPRESARIAL_ENABLED = 'true';

const estado = vi.hoisted(() => ({ userId: '', auditoria: [] as Array<{ action: string; resourceType?: string; metadata?: Record<string, unknown> }> }));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, string>; authUser?: unknown }, reply: { code(n: number): { send(b: unknown): void } }) => {
    const papel = request.headers['x-papel'];
    if (!papel) return reply.code(401).send({ error: 'Missing bearer token' });
    request.authUser = { id: estado.userId, email: 'teste@desigual.test', name: 'Teste', roles: [papel], permissions: [] };
  },
}));
vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { headers: Record<string, string>; tenantContext?: unknown }) => {
    request.tenantContext = { userId: estado.userId, organizationId: request.headers['x-org'], membershipId: 'm', role: 'master', permissions: [], actingAsProvider: false };
  },
}));
vi.mock('../lib/auditoria', () => ({
  auditarAcao: async (_r: unknown, e: { action: string; resourceType?: string; metadata?: Record<string, unknown> }) => void estado.auditoria.push(e),
}));

const { registerGestaoEmpresarialRoutes } = await import('./routes');
const { db, schema } = await import('@desigual-os/database');
const { eq, inArray } = await import('drizzle-orm');

const P = '/gestao-empresarial';
let orgA = '';
let orgB = '';
let app: ReturnType<typeof Fastify>;

const chamar = (metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', caminho: string, opcoes: { org?: string; papel?: string; body?: unknown } = {}) =>
  app.inject({
    method: metodo,
    url: `${P}${caminho}`,
    headers: { ...(opcoes.papel !== null && { 'x-papel': opcoes.papel ?? 'master' }), 'x-org': opcoes.org ?? orgA },
    ...(opcoes.body !== undefined && { payload: opcoes.body as object }),
  });
const A = (m: Parameters<typeof chamar>[0], c: string, body?: unknown) => chamar(m, c, { body });
const B = (m: Parameters<typeof chamar>[0], c: string, body?: unknown) => chamar(m, c, { org: orgB, body });

async function conta(org = orgA, opening: number | null = 0) {
  const r = await chamar('POST', '/financeiro/contas', { org, body: { name: `Conta ${Math.random().toString(36).slice(2, 8)}`, openingBalanceCents: opening, openingDate: '2026-01-01' } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}
async function lancamento(extra: Record<string, unknown> = {}, org = orgA) {
  const r = await chamar('POST', '/financeiro/lancamentos', { org, body: { kind: 'receita', description: 'Serviço', amountCents: 10000, dueDate: '2099-01-10', ...extra } });
  expect(r.statusCode).toBe(201);
  return r.json().items as Array<{ id: string; amountCents: number; dueDate: string; installmentNo: number | null }>;
}
const saldo = async (contaId: string, org = orgA) => {
  const r = await chamar('GET', '/financeiro/contas', { org });
  return (r.json().items as Array<{ id: string; balanceCents: number | null; movementCents: number }>).find((c) => c.id === contaId)!;
};

beforeAll(async () => {
  if (!url) return;
  const sufixo = Math.random().toString(36).slice(2, 10);
  const [u] = await db.insert(schema.users).values({ email: `gestao-${sufixo}@desigual.test`, name: 'Teste Gestão' }).returning();
  estado.userId = u!.id;
  const orgs = await db
    .insert(schema.organizations)
    .values([{ name: 'Org A', slug: `ge-a-${sufixo}` }, { name: 'Org B', slug: `ge-b-${sufixo}` }])
    .returning();
  orgA = orgs[0]!.id;
  orgB = orgs[1]!.id;
  app = Fastify();
  await app.register(registerGestaoEmpresarialRoutes);
  await app.ready();
});

afterAll(async () => {
  if (!url) return;
  await app.close();
  const ids = [orgA, orgB];
  // O razão é RESTRICT contra contas; a limpeza explícita evita depender da ordem das cascatas.
  await db.delete(schema.geStatementLines).where(inArray(schema.geStatementLines.organizationId, ids));
  await db.delete(schema.geLedger).where(inArray(schema.geLedger.organizationId, ids));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, ids));
  await db.delete(schema.users).where(eq(schema.users.id, estado.userId));
});

beforeEach(() => {
  estado.auditoria.length = 0;
});

describe.skipIf(!url)('acesso', () => {
  it('sem login 401; colaborador 403; administrador 200', async () => {
    expect((await chamar('GET', '/cadastros/pessoas', { papel: null as never })).statusCode).toBe(401);
    expect((await chamar('GET', '/cadastros/pessoas', { papel: 'colaborador' })).statusCode).toBe(403);
    expect((await A('GET', '/cadastros/pessoas')).statusCode).toBe(200);
  });

  it('módulo desligado no servidor: 404 até para o administrador', async () => {
    process.env.GESTAO_EMPRESARIAL_ENABLED = 'false';
    try {
      expect((await A('GET', '/cadastros/pessoas')).statusCode).toBe(404);
      expect((await A('GET', '/access')).json()).toEqual({ allowed: false });
    } finally {
      process.env.GESTAO_EMPRESARIAL_ENABLED = 'true';
    }
  });

  it('produção exige o segundo aceite explícito, mesmo com o módulo ligado', async () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect((await A('GET', '/cadastros/pessoas')).statusCode).toBe(404);
      process.env.GESTAO_EMPRESARIAL_ALLOW_PRODUCTION = 'sim';
      expect((await A('GET', '/cadastros/pessoas')).statusCode).toBe(200);
    } finally {
      delete process.env.GESTAO_EMPRESARIAL_ALLOW_PRODUCTION;
      process.env.NODE_ENV = antes;
    }
  });

  it('/access diz sim só para administrador', async () => {
    expect((await A('GET', '/access')).json()).toEqual({ allowed: true });
    expect((await chamar('GET', '/access', { papel: 'colaborador' })).json()).toEqual({ allowed: false });
  });
});

describe.skipIf(!url)('cadastros', () => {
  it('uma entidade pode ser cliente e fornecedor; documento e célula em branco são normalizados', async () => {
    const r = await A('POST', '/cadastros/pessoas', { name: '  Gráfica Exemplo ', document: '11.222.333/0001-81', state: ' ', city: ' ', roles: ['cliente', 'fornecedor'] });
    expect(r.statusCode).toBe(201);
    const p = r.json();
    expect(p).toMatchObject({ name: 'Gráfica Exemplo', document: '11222333000181', rawDocument: '11.222.333/0001-81', documentKind: 'cnpj', documentValid: true, state: null, city: null });
    expect(p.roles).toEqual(['cliente', 'fornecedor']);
    expect(estado.auditoria.map((e) => e.action)).toContain('gestao.pessoa.criada');
  });

  it('documento inválido entra marcado, sem corrigir', async () => {
    const r = await A('POST', '/cadastros/pessoas', { name: 'Doc Ruim', document: '11.222.333/0001-82', roles: ['fornecedor'] });
    expect(r.json()).toMatchObject({ document: '11222333000182', documentValid: false });
    const ruins = (await A('GET', '/cadastros/pessoas?documentoInvalido=true')).json();
    expect(ruins.items.map((i: { name: string }) => i.name)).toContain('Doc Ruim');
  });

  it('mesmo documento não duplica: 409 apontando o existente', async () => {
    await A('POST', '/cadastros/pessoas', { name: 'Original', document: '52998224725', roles: ['cliente'] });
    const dup = await A('POST', '/cadastros/pessoas', { name: 'Outro Nome', document: '529.982.247-25', roles: ['cliente'] });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toContain('Original');
  });

  it('nome igual com documentos diferentes NÃO é fundido', async () => {
    await A('POST', '/cadastros/pessoas', { name: 'Homônimo SA', document: '11144477735', roles: ['cliente'] });
    const r = await A('POST', '/cadastros/pessoas', { name: 'Homônimo SA', roles: ['cliente'] });
    expect(r.statusCode).toBe(201);
  });

  it('e-mail inválido é recusado', async () => {
    expect((await A('POST', '/cadastros/pessoas', { name: 'X', email: 'sem-arroba', roles: ['cliente'] })).statusCode).toBe(400);
  });

  it('exige ao menos um papel e papel conhecido', async () => {
    expect((await A('POST', '/cadastros/pessoas', { name: 'X', roles: [] })).statusCode).toBe(400);
    expect((await A('POST', '/cadastros/pessoas', { name: 'X', roles: ['dono'] })).statusCode).toBe(400);
  });

  it('veículo de mídia guarda o tipo', async () => {
    const r = await A('POST', '/cadastros/pessoas', { name: 'Outdoor Centro', roles: ['veiculo_midia'], mediaType: 'outdoor' });
    const p = (await A('GET', `/cadastros/pessoas/${r.json().id}`)).json();
    expect(p).toMatchObject({ mediaType: 'outdoor', roles: ['veiculo_midia'] });
  });

  it('arquivar mantém o cadastro (não apaga) e a lista filtra por situação', async () => {
    const id = (await A('POST', '/cadastros/pessoas', { name: 'Arquivável Ltda', roles: ['cliente'] })).json().id;
    expect((await A('POST', `/cadastros/pessoas/${id}/arquivar`, {})).json()).toMatchObject({ status: 'inativo' });
    expect((await A('GET', `/cadastros/pessoas/${id}`)).statusCode).toBe(200);
    const ativos = (await A('GET', '/cadastros/pessoas?status=ativo&q=Arquiv')).json();
    expect(ativos.items).toHaveLength(0);
    expect((await A('GET', '/cadastros/pessoas?status=inativo&q=Arquiv')).json().items).toHaveLength(1);
  });

  it('papéis: adicionar é idempotente e remover funciona', async () => {
    const id = (await A('POST', '/cadastros/pessoas', { name: 'Papéis Ltda', roles: ['cliente'] })).json().id;
    expect((await A('POST', `/cadastros/pessoas/${id}/papeis`, { role: 'fornecedor' })).statusCode).toBe(204);
    expect((await A('POST', `/cadastros/pessoas/${id}/papeis`, { role: 'fornecedor' })).statusCode).toBe(204);
    expect((await A('GET', `/cadastros/pessoas/${id}`)).json().roles).toEqual(['cliente', 'fornecedor']);
    await A('DELETE', `/cadastros/pessoas/${id}/papeis/cliente`);
    expect((await A('GET', `/cadastros/pessoas/${id}`)).json().roles).toEqual(['fornecedor']);
  });

  it('ISOLAMENTO: outra organização não vê, não edita e não arquiva', async () => {
    const id = (await A('POST', '/cadastros/pessoas', { name: 'Só da Org A', document: '39053344705', roles: ['cliente'] })).json().id;
    expect((await B('GET', `/cadastros/pessoas/${id}`)).statusCode).toBe(404);
    expect((await B('PATCH', `/cadastros/pessoas/${id}`, { name: 'Invadido' })).statusCode).toBe(404);
    expect((await B('POST', `/cadastros/pessoas/${id}/arquivar`, {})).statusCode).toBe(404);
    expect((await B('GET', '/cadastros/pessoas?q=Só da Org')).json().items).toHaveLength(0);
    // o mesmo documento é livre na outra organização: unicidade é por organização
    expect((await B('POST', '/cadastros/pessoas', { name: 'Na Org B', document: '39053344705', roles: ['cliente'] })).statusCode).toBe(201);
    expect((await A('GET', `/cadastros/pessoas/${id}`)).json().name).toBe('Só da Org A');
  });

  it('paginação no servidor: página, total e teto de 100', async () => {
    for (let i = 0; i < 12; i++) await B('POST', '/cadastros/pessoas', { name: `Paginado ${String(i).padStart(2, '0')}`, roles: ['fornecedor'] });
    const p1 = (await B('GET', '/cadastros/pessoas?q=Paginado&pageSize=5&page=1')).json();
    const p3 = (await B('GET', '/cadastros/pessoas?q=Paginado&pageSize=5&page=3')).json();
    expect(p1).toMatchObject({ total: 12, page: 1, pageSize: 5, totalPages: 3 });
    expect(p1.items).toHaveLength(5);
    expect(p3.items).toHaveLength(2);
    expect(p1.items[0].name).toBe('Paginado 00');
    expect((await B('GET', '/cadastros/pessoas?pageSize=101')).statusCode).toBe(400);
  });

  it('filtra por papel e por documento ausente, sem trazer o que não pertence', async () => {
    await B('POST', '/cadastros/pessoas', { name: 'Só Cliente Filtro', roles: ['cliente'] });
    await B('POST', '/cadastros/pessoas', { name: 'Só Fornecedor Filtro', document: '11144477735', roles: ['fornecedor'] });
    await B('POST', '/cadastros/pessoas', { name: 'Ambos Filtro', roles: ['cliente', 'fornecedor'] });
    const nomes = async (qs: string) => ((await B('GET', `/cadastros/pessoas?q=Filtro&${qs}`)).json().items as Array<{ name: string }>).map((i) => i.name).sort();
    expect(await nomes('role=cliente')).toEqual(['Ambos Filtro', 'Só Cliente Filtro']);
    expect(await nomes('role=fornecedor')).toEqual(['Ambos Filtro', 'Só Fornecedor Filtro']);
    expect(await nomes('role=veiculo_midia')).toEqual([]);
    expect(await nomes('semDocumento=true')).toEqual(['Ambos Filtro', 'Só Cliente Filtro']);
  });

  it('vínculo com cliente do Desigual OS: cliente inexistente é 404', async () => {
    const id = (await A('POST', '/cadastros/pessoas', { name: 'Vincular', roles: ['cliente'] })).json().id;
    expect((await A('PUT', `/cadastros/pessoas/${id}/cliente`, { clientId: '11111111-1111-4111-8111-111111111111' })).statusCode).toBe(404);
    expect((await A('PUT', `/cadastros/pessoas/${id}/cliente`, { clientId: null })).statusCode).toBe(200);
  });
});

describe.skipIf(!url)('lançamentos', () => {
  it('valor precisa ser inteiro em centavos: 12.5 e 0 são recusados', async () => {
    for (const amountCents of [12.5, 0, -1, '100']) {
      const r = await A('POST', '/financeiro/lancamentos', { kind: 'receita', description: 'x', amountCents, dueDate: '2099-01-10' });
      expect(r.statusCode, String(amountCents)).toBe(400);
    }
  });

  it('parcelado: N parcelas que somam exatamente o total, no mesmo grupo, com mês curto', async () => {
    const itens = await lancamento({ amountCents: 10000, dueDate: '2099-01-31', parcelas: 3 });
    expect(itens.map((i) => i.amountCents)).toEqual([3334, 3333, 3333]);
    expect(itens.map((i) => i.dueDate)).toEqual(['2099-01-31', '2099-02-28', '2099-03-31']);
    expect(itens.map((i) => i.installmentNo)).toEqual([1, 2, 3]);
    expect(itens.reduce((s, i) => s + i.amountCents, 0)).toBe(10000);
  });

  it('referência de OUTRA organização vale 404 (categoria, conta, cadastro)', async () => {
    const catB = (await B('POST', '/financeiro/categorias', { name: 'Cat B', kind: 'receita' })).json().id;
    const contaB = await conta(orgB);
    const pessoaB = (await B('POST', '/cadastros/pessoas', { name: 'Pessoa B', roles: ['cliente'] })).json().id;
    for (const extra of [{ categoryId: catB }, { accountId: contaB }, { partyId: pessoaB }]) {
      const r = await A('POST', '/financeiro/lancamentos', { kind: 'receita', description: 'x', amountCents: 100, dueDate: '2099-01-10', ...extra });
      expect(r.statusCode).toBe(404);
    }
  });

  it('baixa move o saldo da conta pelo razão; baixar de novo é 409', async () => {
    const c = await conta(orgA, 5000);
    const [l] = await lancamento({ amountCents: 10000 });
    const r = await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22' });
    expect(r.json()).toMatchObject({ status: 'quitado', paidAt: '2026-10-22', paidAmountCents: 10000 });
    expect(await saldo(c)).toMatchObject({ balanceCents: 15000, movementCents: 10000 });
    expect((await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22' })).statusCode).toBe(409);
    expect(await saldo(c)).toMatchObject({ balanceCents: 15000 });
  });

  it('despesa baixada SAI da conta', async () => {
    const c = await conta(orgA, 10000);
    const [l] = await lancamento({ kind: 'despesa', amountCents: 2500 });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22' });
    expect(await saldo(c)).toMatchObject({ balanceCents: 7500, movementCents: -2500 });
  });

  it('baixa com valor diferente (juros/desconto) grava o pago e preserva o previsto', async () => {
    const c = await conta();
    const [l] = await lancamento({ amountCents: 10000 });
    const r = (await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22', paidAmountCents: 9500 })).json();
    expect(r).toMatchObject({ amountCents: 10000, paidAmountCents: 9500 });
    expect((await saldo(c)).movementCents).toBe(9500);
  });

  it('estorno NÃO apaga a baixa: o razão guarda os dois movimentos e o saldo volta', async () => {
    const c = await conta(orgA, 1000);
    const [l] = await lancamento({ amountCents: 4000 });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22' });
    const e = await A('POST', `/financeiro/lancamentos/${l!.id}/estornar`, { motivo: 'Pagamento lançado na conta errada' });
    expect(e.json()).toMatchObject({ status: 'aberto', paidAt: null, paidAmountCents: null });
    expect(await saldo(c)).toMatchObject({ balanceCents: 1000, movementCents: 0 });
    const razao = await db.select().from(schema.geLedger).where(eq(schema.geLedger.entryId, l!.id));
    expect(razao.map((m) => m.amountCents).sort((a, b) => a - b)).toEqual([-4000, 4000]);
    expect(razao.find((m) => m.kind === 'estorno')).toMatchObject({ memo: 'Pagamento lançado na conta errada' });
    expect((await A('POST', `/financeiro/lancamentos/${l!.id}/estornar`, { motivo: 'de novo' })).statusCode).toBe(409);
  });

  it('baixar, estornar e baixar de novo: o segundo estorno reverte SÓ a segunda baixa', async () => {
    const c = await conta(orgA, 0);
    const [l] = await lancamento({ amountCents: 700 });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-20' });
    await A('POST', `/financeiro/lancamentos/${l!.id}/estornar`, { motivo: 'erro 1' });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-21' });
    expect((await saldo(c)).movementCents).toBe(700);
    await A('POST', `/financeiro/lancamentos/${l!.id}/estornar`, { motivo: 'erro 2' });
    expect((await saldo(c)).movementCents).toBe(0);
    const razao = await db.select().from(schema.geLedger).where(eq(schema.geLedger.entryId, l!.id));
    expect(razao).toHaveLength(4);
  });

  it('cancelar: aberto sim com motivo; quitado não; editar quitado não', async () => {
    const [aberto] = await lancamento();
    const r = await A('POST', `/financeiro/lancamentos/${aberto!.id}/cancelar`, { motivo: 'Cliente desistiu' });
    expect(r.json()).toMatchObject({ status: 'cancelado', cancelReason: 'Cliente desistiu' });
    expect((await A('POST', `/financeiro/lancamentos/${aberto!.id}/cancelar`, { motivo: 'x' })).statusCode).toBe(409);
    expect((await A('POST', `/financeiro/lancamentos/${aberto!.id}/baixar`, { accountId: await conta(), paidOn: '2026-10-22' })).statusCode).toBe(409);
    expect((await A('POST', `/financeiro/lancamentos/${aberto!.id}/cancelar`, {})).statusCode).toBe(400);

    const [pago] = await lancamento();
    await A('POST', `/financeiro/lancamentos/${pago!.id}/baixar`, { accountId: await conta(), paidOn: '2026-10-22' });
    expect((await A('POST', `/financeiro/lancamentos/${pago!.id}/cancelar`, { motivo: 'x' })).statusCode).toBe(409);
    expect((await A('PATCH', `/financeiro/lancamentos/${pago!.id}`, { description: 'novo' })).statusCode).toBe(409);
  });

  it('editar aberto funciona e fica na auditoria', async () => {
    const [l] = await lancamento();
    const r = await A('PATCH', `/financeiro/lancamentos/${l!.id}`, { description: 'Descrição nova', amountCents: 12345 });
    expect(r.json()).toMatchObject({ description: 'Descrição nova', amountCents: 12345 });
    expect(estado.auditoria.find((e) => e.action === 'gestao.lancamento.editado')?.metadata).toEqual({ campos: ['description', 'amountCents'] });
  });

  it('ISOLAMENTO: outra organização não baixa, cancela, estorna nem edita', async () => {
    const [l] = await lancamento();
    const contaB = await conta(orgB);
    expect((await B('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: contaB, paidOn: '2026-10-22' })).statusCode).toBe(404);
    expect((await B('POST', `/financeiro/lancamentos/${l!.id}/cancelar`, { motivo: 'x' })).statusCode).toBe(404);
    expect((await B('POST', `/financeiro/lancamentos/${l!.id}/estornar`, { motivo: 'x' })).statusCode).toBe(404);
    expect((await B('PATCH', `/financeiro/lancamentos/${l!.id}`, { description: 'x' })).statusCode).toBe(404);
  });

  it('vencido é calculado: filtro devolve só aberto com vencimento passado', async () => {
    await lancamento({ description: 'Venceu faz tempo', dueDate: '2020-01-10' });
    await lancamento({ description: 'Vence no futuro', dueDate: '2099-01-10' });
    const v = (await A('GET', '/financeiro/lancamentos?situacao=vencido&pageSize=100')).json();
    expect(v.items.every((i: { situacao: string }) => i.situacao === 'vencido')).toBe(true);
    expect(v.items.map((i: { description: string }) => i.description)).toContain('Venceu faz tempo');
    expect(v.items.map((i: { description: string }) => i.description)).not.toContain('Vence no futuro');
    expect(v.somaCentavos).toBeGreaterThan(0);
  });

  it('listagem paginada no servidor com soma do filtro', async () => {
    for (let i = 0; i < 7; i++) await lancamento({ description: `Paginado lanc ${i}`, amountCents: 100 }, orgB);
    const r = (await B('GET', '/financeiro/lancamentos?q=Paginado lanc&pageSize=3&page=2')).json();
    expect(r).toMatchObject({ total: 7, page: 2, pageSize: 3, somaCentavos: 700 });
    expect(r.items).toHaveLength(3);
  });

  it('busca com % e _ é literal, não curinga', async () => {
    await lancamento({ description: 'Desconto de 10% aplicado' }, orgB);
    expect((await B('GET', '/financeiro/lancamentos?q=10%25')).json().total).toBeGreaterThanOrEqual(1);
    expect((await B('GET', '/financeiro/lancamentos?q=%25%25%25')).json().total).toBe(0);
  });
});

describe.skipIf(!url)('transferências e saldos', () => {
  it('move dinheiro entre contas sem criar nem perder centavo', async () => {
    const origem = await conta(orgA, 10000);
    const destino = await conta(orgA, 0);
    const r = await A('POST', '/financeiro/transferencias', { fromAccountId: origem, toAccountId: destino, amountCents: 3333, occurredOn: '2026-10-22' });
    expect(r.statusCode).toBe(201);
    const [s1, s2] = [await saldo(origem), await saldo(destino)];
    expect(s1.balanceCents).toBe(6667);
    expect(s2.balanceCents).toBe(3333);
    expect((s1.balanceCents ?? 0) + (s2.balanceCents ?? 0)).toBe(10000);
  });

  it('mesma conta é recusada; conta de outra organização é 404', async () => {
    const c = await conta();
    expect((await A('POST', '/financeiro/transferencias', { fromAccountId: c, toAccountId: c, amountCents: 100, occurredOn: '2026-10-22' })).statusCode).toBe(400);
    const contaB = await conta(orgB);
    expect((await A('POST', '/financeiro/transferencias', { fromAccountId: c, toAccountId: contaB, amountCents: 100, occurredOn: '2026-10-22' })).statusCode).toBe(404);
  });

  it('saldo inicial desconhecido NÃO vira zero: o saldo é nulo', async () => {
    const c = await conta(orgA, null);
    const [l] = await lancamento({ amountCents: 500 });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22' });
    expect(await saldo(c)).toMatchObject({ balanceCents: null, movementCents: 500 });
  });
});

describe.skipIf(!url)('recorrências', () => {
  it('gera as ocorrências, e gerar de novo não duplica', async () => {
    const r = await A('POST', '/financeiro/recorrencias', { kind: 'despesa', description: 'Aluguel recorrente', amountCents: 250000, frequency: 'mensal', startDate: '2099-01-31' });
    expect(r.statusCode).toBe(201);
    const g1 = (await A('POST', '/financeiro/recorrencias/gerar', { ate: '2099-04-30', recorrenciaId: r.json().id })).json();
    expect(g1.criados).toBe(4);
    expect((await A('POST', '/financeiro/recorrencias/gerar', { ate: '2099-04-30', recorrenciaId: r.json().id })).json().criados).toBe(0);
    expect((await A('POST', '/financeiro/recorrencias/gerar', { ate: '2099-06-30', recorrenciaId: r.json().id })).json().criados).toBe(2);
    const lista = (await A('GET', '/financeiro/lancamentos?q=Aluguel recorrente&pageSize=100')).json();
    expect(lista.total).toBe(6);
    expect(lista.items.map((i: { dueDate: string }) => i.dueDate).sort()).toEqual(['2099-01-31', '2099-02-28', '2099-03-31', '2099-04-30', '2099-05-31', '2099-06-30']);
  });

  it('duas gerações SIMULTÂNEAS não duplicam (índice único de origem)', async () => {
    const r = await A('POST', '/financeiro/recorrencias', { kind: 'receita', description: 'Mensalidade concorrente', amountCents: 9900, frequency: 'mensal', startDate: '2099-01-05' });
    const id = r.json().id;
    await Promise.all([1, 2, 3].map(() => A('POST', '/financeiro/recorrencias/gerar', { ate: '2099-05-05', recorrenciaId: id })));
    expect((await A('GET', '/financeiro/lancamentos?q=Mensalidade concorrente&pageSize=100')).json().total).toBe(5);
  });
});

describe.skipIf(!url)('fluxo de caixa', () => {
  it('projeta o aberto, separa o vencido e avisa das contas sem saldo inicial', async () => {
    await conta(orgB, null);
    await lancamento({ description: 'Atrasado fluxo', amountCents: 1000, dueDate: '2020-02-01' }, orgB);
    const f = (await B('GET', '/financeiro/fluxo-de-caixa')).json();
    expect(f.vencidoACobrar).toBeGreaterThanOrEqual(1000);
    expect(f.contasSemSaldoInicial).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(f.meses)).toBe(true);
  });
});

describe.skipIf(!url)('conciliação', () => {
  it('importa extrato sem duplicar, sugere por valor e data, e só concilia com confirmação', async () => {
    const c = await conta(orgA, 0);
    const [l] = await lancamento({ amountCents: 7777 });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-20' });
    const linhas = [
      { postedOn: '2026-10-21', description: 'PIX recebido', amountCents: 7777, externalKey: 'fit-1' },
      { postedOn: '2026-10-21', description: 'Tarifa', amountCents: -990, externalKey: 'fit-2' },
    ];
    expect((await A('POST', `/financeiro/extrato/${c}/importar`, { linhas })).json()).toEqual({ recebidas: 2, novas: 2, jaExistiam: 0 });
    expect((await A('POST', `/financeiro/extrato/${c}/importar`, { linhas })).json()).toEqual({ recebidas: 2, novas: 0, jaExistiam: 2 });

    const s = (await A('GET', `/financeiro/extrato/${c}/sugestoes`)).json();
    const pix = s.linhas.find((x: { externalKey: string }) => x.externalKey === 'fit-1');
    const sug = s.sugestoes.find((x: { linhaId: string }) => x.linhaId === pix.id);
    expect(sug.movimentoId).toBeTruthy();
    expect(s.sugestoes.find((x: { linhaId: string }) => x.linhaId !== pix.id).movimentoId).toBeNull();
    // sugerir não concilia
    expect((await A('GET', `/financeiro/extrato/${c}/sugestoes`)).json().linhas).toHaveLength(2);

    expect((await A('POST', '/financeiro/conciliacao', { linhaId: pix.id, ledgerId: sug.movimentoId })).statusCode).toBe(200);
    expect((await A('POST', '/financeiro/conciliacao', { linhaId: pix.id, ledgerId: sug.movimentoId })).statusCode).toBe(409);
    expect((await A('GET', `/financeiro/extrato/${c}/sugestoes`)).json().linhas).toHaveLength(1);
    expect((await A('DELETE', `/financeiro/conciliacao/${pix.id}`)).statusCode).toBe(200);
    expect((await A('GET', `/financeiro/extrato/${c}/sugestoes`)).json().linhas).toHaveLength(2);
  });

  it('valor diferente e movimento já usado por outra linha são recusados', async () => {
    const c = await conta(orgA, 0);
    const [l] = await lancamento({ amountCents: 5000 });
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-20' });
    const r = await chamar('POST', `/financeiro/extrato/${c}/importar`, {
      body: { linhas: [{ postedOn: '2026-10-20', amountCents: 4999, externalKey: 'k1' }, { postedOn: '2026-10-20', amountCents: 5000, externalKey: 'k2' }, { postedOn: '2026-10-20', amountCents: 5000, externalKey: 'k3' }] },
    });
    expect(r.statusCode).toBe(200);
    const s = (await A('GET', `/financeiro/extrato/${c}/sugestoes`)).json();
    const por = (k: string) => s.linhas.find((x: { externalKey: string }) => x.externalKey === k).id as string;
    const ledgerId = (await db.select().from(schema.geLedger).where(eq(schema.geLedger.entryId, l!.id)))[0]!.id;
    expect((await A('POST', '/financeiro/conciliacao', { linhaId: por('k1'), ledgerId })).statusCode).toBe(409);
    expect((await A('POST', '/financeiro/conciliacao', { linhaId: por('k2'), ledgerId })).statusCode).toBe(200);
    expect((await A('POST', '/financeiro/conciliacao', { linhaId: por('k3'), ledgerId })).statusCode).toBe(409);
  });

  it('extrato duplicado entre organizações não vaza: conta de outra org é 404', async () => {
    const contaB = await conta(orgB);
    const r = await A('POST', `/financeiro/extrato/${contaB}/importar`, { linhas: [{ postedOn: '2026-10-20', amountCents: 100, externalKey: 'x' }] });
    expect(r.statusCode).toBe(404);
  });
});

describe.skipIf(!url)('o rastro de auditoria', () => {
  it('toda escrita financeira deixa um registro com o recurso afetado', async () => {
    const c = await conta();
    const [l] = await lancamento();
    await A('POST', `/financeiro/lancamentos/${l!.id}/baixar`, { accountId: c, paidOn: '2026-10-22' });
    await A('POST', `/financeiro/lancamentos/${l!.id}/estornar`, { motivo: 'auditar' });
    const acoes = estado.auditoria.map((e) => e.action);
    expect(acoes).toEqual(expect.arrayContaining(['gestao.conta.criada', 'gestao.lancamento.criado', 'gestao.lancamento.baixado', 'gestao.lancamento.estornado']));
    expect(estado.auditoria.find((e) => e.action === 'gestao.lancamento.baixado')).toMatchObject({ resourceType: 'ge_entry' });
  });
});
