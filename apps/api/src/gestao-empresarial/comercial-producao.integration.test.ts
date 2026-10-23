import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Comercial, Produção e Relatórios contra o Postgres LOCAL (GESTAO_TEST_DATABASE_URL). */
const url = process.env.GESTAO_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
else process.env.DATABASE_URL ??= 'postgres://t:t@127.0.0.1:1/t';
process.env.GESTAO_EMPRESARIAL_ENABLED = 'true';

const estado = vi.hoisted(() => ({ userId: '', auditoria: [] as Array<{ action: string; metadata?: Record<string, unknown> }> }));
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, string>; authUser?: unknown }, reply: { code(n: number): { send(b: unknown): void } }) => {
    const papel = request.headers['x-papel'];
    if (!papel) return reply.code(401).send({ error: 'Missing bearer token' });
    request.authUser = { id: estado.userId, email: 't@desigual.test', name: 'Teste', roles: [papel], permissions: [] };
  },
}));
vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { headers: Record<string, string>; tenantContext?: unknown }) => {
    request.tenantContext = { userId: estado.userId, organizationId: request.headers['x-org'], membershipId: 'm', role: 'master', permissions: [], actingAsProvider: false };
  },
}));
vi.mock('../lib/auditoria', () => ({ auditarAcao: async (_r: unknown, e: { action: string; metadata?: Record<string, unknown> }) => void estado.auditoria.push(e) }));

const { registerGestaoEmpresarialRoutes } = await import('./routes');
const { db, schema } = await import('@desigual-os/database');
const { eq, inArray, and } = await import('drizzle-orm');

const P = '/gestao-empresarial';
let orgA = '';
let orgB = '';
let orgR = '';
let app: ReturnType<typeof Fastify>;
const chamar = (org: string, metodo: 'GET' | 'POST' | 'PATCH', caminho: string, body?: unknown) =>
  app.inject({ method: metodo, url: `${P}${caminho}`, headers: { 'x-papel': 'master', 'x-org': org }, ...(body !== undefined && { payload: body as object }) });
const A = (m: 'GET' | 'POST' | 'PATCH', c: string, b?: unknown) => chamar(orgA, m, c, b);

const itens = [{ description: 'Banner', quantity: 3, unitPriceCents: 3333, discountCents: 99 }, { description: 'Lona', quantity: 1, unitPriceCents: 1, discountCents: 0 }];
async function proposta(org = orgA, extra: Record<string, unknown> = {}) {
  const r = await chamar(org, 'POST', '/comercial/propostas', { title: 'Campanha', items: itens, ...extra });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string; number: string; totalCents: number; status: string };
}
async function aprovada(org = orgA, extra: Record<string, unknown> = {}) {
  const p = await proposta(org, extra);
  expect((await chamar(org, 'POST', `/comercial/propostas/${p.id}/status`, { status: 'enviada' })).statusCode).toBe(200);
  expect((await chamar(org, 'POST', `/comercial/propostas/${p.id}/status`, { status: 'aprovada' })).statusCode).toBe(200);
  return p;
}
async function pessoa(org: string, roles: string[], name = `Pessoa ${Math.random().toString(36).slice(2, 8)}`) {
  const r = await chamar(org, 'POST', '/cadastros/pessoas', { name, roles });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

beforeAll(async () => {
  if (!url) return;
  const suf = Math.random().toString(36).slice(2, 10);
  const [u] = await db.insert(schema.users).values({ email: `cpr-${suf}@desigual.test`, name: 'Teste CPR' }).returning();
  estado.userId = u!.id;
  const orgs = await db.insert(schema.organizations).values([{ name: 'A', slug: `cpr-a-${suf}` }, { name: 'B', slug: `cpr-b-${suf}` }, { name: 'R', slug: `cpr-r-${suf}` }]).returning();
  [orgA, orgB, orgR] = orgs.map((o) => o.id) as [string, string, string];
  app = Fastify();
  await app.register(registerGestaoEmpresarialRoutes);
  await app.ready();
});
afterAll(async () => {
  if (!url) return;
  await app.close();
  const ids = [orgA, orgB, orgR];
  await db.delete(schema.geLedger).where(inArray(schema.geLedger.organizationId, ids));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, ids));
  await db.delete(schema.users).where(eq(schema.users.id, estado.userId));
});
beforeEach(() => void (estado.auditoria.length = 0));

describe.skipIf(!url)('propostas', () => {
  it('numera em série POR organização e calcula o total em centavos exatos', async () => {
    const [a1, b1] = [await proposta(orgA), await proposta(orgB)];
    expect(a1.totalCents).toBe(3 * 3333 - 99 + 1);
    expect(a1.number).toMatch(/^P-\d{4}$/);
    expect(b1.number).toBe('P-0001');
    const a2 = await proposta(orgA);
    expect(Number(a2.number.slice(2))).toBe(Number(a1.number.slice(2)) + 1);
  });

  it('criações SIMULTÂNEAS nunca repetem número', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => chamar(orgB, 'POST', '/comercial/propostas', { title: 'Concorrente', items: [] })));
    expect(rs.every((r) => r.statusCode === 201)).toBe(true);
    const numeros = rs.map((r) => r.json().number as string);
    expect(new Set(numeros).size).toBe(8);
  });

  it('desconto maior que a linha, item fracionado e serviço de outra organização são recusados', async () => {
    expect((await A('POST', '/comercial/propostas', { title: 'x', items: [{ description: 'a', quantity: 1, unitPriceCents: 100, discountCents: 101 }] })).statusCode).toBe(400);
    expect((await A('POST', '/comercial/propostas', { title: 'x', items: [{ description: 'a', quantity: 1, unitPriceCents: 10.5, discountCents: 0 }] })).statusCode).toBe(400);
    const servicoB = (await chamar(orgB, 'POST', '/cadastros/servicos', { name: 'Serviço B', kind: 'venda' })).json().id;
    expect((await A('POST', '/comercial/propostas', { title: 'x', items: [{ description: 'a', quantity: 1, unitPriceCents: 100, discountCents: 0, serviceId: servicoB }] })).statusCode).toBe(404);
  });

  it('só se edita em rascunho; enviar sem itens é 409; aprovada é final', async () => {
    const vazia = (await A('POST', '/comercial/propostas', { title: 'Vazia', items: [] })).json();
    expect((await A('POST', `/comercial/propostas/${vazia.id}/status`, { status: 'enviada' })).statusCode).toBe(409);
    const p = await proposta();
    expect((await A('PATCH', `/comercial/propostas/${p.id}`, { title: 'Novo título', items: [{ description: 'Só um', quantity: 2, unitPriceCents: 500, discountCents: 0 }] })).json()).toMatchObject({ title: 'Novo título', totalCents: 1000 });
    await A('POST', `/comercial/propostas/${p.id}/status`, { status: 'enviada' });
    expect((await A('PATCH', `/comercial/propostas/${p.id}`, { title: 'Tarde demais' })).statusCode).toBe(409);
    expect((await A('POST', `/comercial/propostas/${p.id}/status`, { status: 'aprovada' })).statusCode).toBe(200);
    for (const status of ['rascunho', 'enviada', 'recusada', 'cancelada']) expect((await A('POST', `/comercial/propostas/${p.id}/status`, { status })).statusCode, status).toBe(409);
  });

  it('rascunho não pula direto para aprovada', async () => {
    const p = await proposta();
    expect((await A('POST', `/comercial/propostas/${p.id}/status`, { status: 'aprovada' })).statusCode).toBe(409);
  });

  it('listagem paginada traz o total de cada proposta', async () => {
    const r = (await chamar(orgB, 'GET', '/comercial/propostas?pageSize=3&page=1')).json();
    expect(r.items.length).toBeLessThanOrEqual(3);
    expect(r.total).toBeGreaterThanOrEqual(8);
    expect(typeof r.items[0].totalCents).toBe('number');
    // o total da listagem é o dos itens, não zero (um SELECT qualificado errado já devolveu 0 aqui)
    const p = await proposta(orgB);
    const lista = (await chamar(orgB, 'GET', '/comercial/propostas?pageSize=100')).json().items;
    expect(lista.find((x: { id: string }) => x.id === p.id).totalCents).toBe(p.totalCents);
    expect(p.totalCents).toBeGreaterThan(0);
  });

  it('ISOLAMENTO: outra organização não vê nem altera a proposta', async () => {
    const p = await proposta();
    expect((await chamar(orgB, 'GET', `/comercial/propostas/${p.id}`)).statusCode).toBe(404);
    expect((await chamar(orgB, 'PATCH', `/comercial/propostas/${p.id}`, { title: 'x' })).statusCode).toBe(404);
    expect((await chamar(orgB, 'POST', `/comercial/propostas/${p.id}/status`, { status: 'enviada' })).statusCode).toBe(404);
  });
});

describe.skipIf(!url)('contratos, pedidos e faturamento', () => {
  it('contrato e pedido só nascem de proposta APROVADA, e um por proposta', async () => {
    const rascunho = await proposta();
    expect((await A('POST', '/comercial/contratos', { proposalId: rascunho.id })).statusCode).toBe(409);
    expect((await A('POST', '/comercial/pedidos', { proposalId: rascunho.id })).statusCode).toBe(409);
    const p = await aprovada();
    const c = (await A('POST', '/comercial/contratos', { proposalId: p.id, startsOn: '2026-11-01', endsOn: '2027-10-31' })).json();
    expect(c).toMatchObject({ title: 'Campanha', totalCents: p.totalCents, status: 'rascunho', proposalId: p.id });
    expect((await A('POST', '/comercial/contratos', { proposalId: p.id })).statusCode).toBe(409);
    expect((await A('POST', '/comercial/contratos', { title: 'Avulso', totalCents: 100, startsOn: '2026-12-01', endsOn: '2026-01-01' })).statusCode).toBe(422);
  });

  it('contrato: vigente → encerrado, e encerrado é final', async () => {
    const c = (await A('POST', '/comercial/contratos', { title: 'Avulso', totalCents: 5000 })).json();
    expect((await A('POST', `/comercial/contratos/${c.id}/status`, { status: 'encerrado' })).statusCode).toBe(409);
    expect((await A('POST', `/comercial/contratos/${c.id}/status`, { status: 'vigente' })).statusCode).toBe(200);
    expect((await A('POST', `/comercial/contratos/${c.id}/status`, { status: 'encerrado' })).statusCode).toBe(200);
    expect((await A('POST', `/comercial/contratos/${c.id}/status`, { status: 'vigente' })).statusCode).toBe(409);
  });

  it('FATURAR gera contas a receber parceladas que somam o total, uma única vez', async () => {
    const cliente = await pessoa(orgA, ['cliente']);
    const p = await aprovada(orgA, { partyId: cliente });
    const o = (await A('POST', '/comercial/pedidos', { proposalId: p.id })).json();
    expect(o).toMatchObject({ status: 'aberto', totalCents: p.totalCents, partyId: cliente });
    expect((await A('POST', '/comercial/pedidos', { proposalId: p.id })).statusCode).toBe(409);

    const f = (await A('POST', `/comercial/pedidos/${o.id}/faturar`, { parcelas: 3, primeiroVencimento: '2099-01-31' })).json();
    expect(f.pedido.status).toBe('faturado');
    expect(f.lancamentos.map((l: { dueDate: string }) => l.dueDate)).toEqual(['2099-01-31', '2099-02-28', '2099-03-31']);
    expect(f.lancamentos.reduce((s: number, l: { amountCents: number }) => s + l.amountCents, 0)).toBe(p.totalCents);
    expect(f.lancamentos[0]).toMatchObject({ kind: 'receita', status: 'aberto', partyId: cliente, relatedKind: 'pedido', relatedRef: o.number, installmentNo: 1, installmentTotal: 3 });

    expect((await A('POST', `/comercial/pedidos/${o.id}/faturar`, { parcelas: 1, primeiroVencimento: '2099-01-31' })).statusCode).toBe(409);
    expect((await A('POST', `/comercial/pedidos/${o.id}/cancelar`)).statusCode).toBe(409);
    const gerados = (await A('GET', `/financeiro/lancamentos?partyId=${cliente}&pageSize=100`)).json();
    expect(gerados.total).toBe(3);
  });

  it('faturamentos SIMULTÂNEOS do mesmo pedido geram as parcelas uma só vez', async () => {
    const o = (await A('POST', '/comercial/pedidos', { title: 'Concorrente', totalCents: 9000 })).json();
    const rs = await Promise.all([1, 2, 3, 4].map(() => A('POST', `/comercial/pedidos/${o.id}/faturar`, { parcelas: 3, primeiroVencimento: '2099-05-10' })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409]);
    const linhas = await db.select().from(schema.geEntries).where(and(eq(schema.geEntries.organizationId, orgA), eq(schema.geEntries.relatedRef, o.number)));
    expect(linhas).toHaveLength(3);
    expect(linhas.reduce((s, l) => s + l.amountCents, 0)).toBe(9000);
  });

  it('pedido de valor zero não fatura; cancelado não fatura; referências de outra organização são 404', async () => {
    const zero = (await A('POST', '/comercial/pedidos', { title: 'Zero', totalCents: 0 })).json();
    expect((await A('POST', `/comercial/pedidos/${zero.id}/faturar`, { parcelas: 1, primeiroVencimento: '2099-01-10' })).statusCode).toBe(409);
    const canc = (await A('POST', '/comercial/pedidos', { title: 'Cancelar', totalCents: 500 })).json();
    expect((await A('POST', `/comercial/pedidos/${canc.id}/cancelar`)).json()).toMatchObject({ status: 'cancelado' });
    expect((await A('POST', `/comercial/pedidos/${canc.id}/faturar`, { parcelas: 1, primeiroVencimento: '2099-01-10' })).statusCode).toBe(409);
    const ok = (await A('POST', '/comercial/pedidos', { title: 'Ref', totalCents: 500 })).json();
    const catB = (await chamar(orgB, 'POST', '/financeiro/categorias', { name: 'Cat B Fat', kind: 'receita' })).json().id;
    expect((await A('POST', `/comercial/pedidos/${ok.id}/faturar`, { parcelas: 1, primeiroVencimento: '2099-01-10', categoryId: catB })).statusCode).toBe(404);
    expect((await A('GET', `/comercial/pedidos?status=aberto`)).json().items.map((x: { id: string }) => x.id)).toContain(ok.id);
  });

  it('ISOLAMENTO: outra organização não fatura nem cancela o pedido', async () => {
    const o = (await A('POST', '/comercial/pedidos', { title: 'Iso', totalCents: 500 })).json();
    expect((await chamar(orgB, 'POST', `/comercial/pedidos/${o.id}/faturar`, { parcelas: 1, primeiroVencimento: '2099-01-10' })).statusCode).toBe(404);
    expect((await chamar(orgB, 'POST', `/comercial/pedidos/${o.id}/cancelar`)).statusCode).toBe(404);
  });
});

describe.skipIf(!url)('produção: solicitação, cotações, pedido e custos', () => {
  async function solicitacao(extra: Record<string, unknown> = {}) {
    const r = await A('POST', '/producao/solicitacoes', { title: 'Adesivagem de frota', ...extra });
    expect(r.statusCode).toBe(201);
    return r.json() as { id: string; number: string };
  }

  it('cotação só de quem é fornecedor, veículo ou prestador', async () => {
    const s = await solicitacao();
    const cliente = await pessoa(orgA, ['cliente']);
    const r = await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: cliente, totalCents: 1000 });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/fornecedor/);
    const forn = await pessoa(orgA, ['fornecedor']);
    expect((await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: forn, totalCents: 1000 })).statusCode).toBe(201);
    const fornB = await pessoa(orgB, ['fornecedor']);
    expect((await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: fornB, totalCents: 1000 })).statusCode).toBe(404);
  });

  it('compara da mais barata para a mais cara, com a diferença; escolher descarta as outras', async () => {
    const s = await solicitacao();
    const [f1, f2, f3] = [await pessoa(orgA, ['fornecedor'], 'Barato Ltda'), await pessoa(orgA, ['fornecedor'], 'Médio Ltda'), await pessoa(orgA, ['veiculo_midia'], 'Caro Outdoor')];
    const cot = async (supplierId: string, totalCents: number) => (await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId, totalCents, leadTimeDays: 5 })).json();
    const [c1, c2, c3] = [await cot(f2, 150000), await cot(f1, 120000), await cot(f3, 180000)];
    const comp = (await A('GET', `/producao/solicitacoes/${s.id}/cotacoes`)).json();
    expect(comp.solicitacao.status).toBe('cotando');
    expect(comp.cotacoes.map((c: { fornecedor: string; diferencaParaMenorCents: number }) => [c.fornecedor, c.diferencaParaMenorCents])).toEqual([['Barato Ltda', 0], ['Médio Ltda', 30000], ['Caro Outdoor', 60000]]);

    expect((await A('POST', `/producao/solicitacoes/${s.id}/cotacoes/${c2.id}/escolher`)).json()).toMatchObject({ status: 'escolhida' });
    const depois = (await A('GET', `/producao/solicitacoes/${s.id}/cotacoes`)).json();
    expect(depois.solicitacao.status).toBe('aprovada');
    expect(depois.cotacoes.map((c: { status: string }) => c.status)).toEqual(['escolhida', 'descartada', 'descartada']);
    expect((await A('POST', `/producao/solicitacoes/${s.id}/cotacoes/${c1.id}/escolher`)).statusCode).toBe(409);
    expect((await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: f1, totalCents: 1 })).statusCode).toBe(409);
    void c3;
  });

  it('cotação de OUTRA solicitação não pode ser escolhida', async () => {
    const [s1, s2] = [await solicitacao(), await solicitacao()];
    const forn = await pessoa(orgA, ['fornecedor']);
    const doS2 = (await A('POST', `/producao/solicitacoes/${s2.id}/cotacoes`, { supplierId: forn, totalCents: 500 })).json();
    await A('POST', `/producao/solicitacoes/${s1.id}/cotacoes`, { supplierId: forn, totalCents: 500 });
    expect((await A('POST', `/producao/solicitacoes/${s1.id}/cotacoes/${doS2.id}/escolher`)).statusCode).toBe(404);
  });

  it('pedido de produção exige cotação escolhida; um por solicitação', async () => {
    const s = await solicitacao();
    expect((await A('POST', '/producao/pedidos', { requestId: s.id })).statusCode).toBe(409);
    const forn = await pessoa(orgA, ['fornecedor']);
    const c = (await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: forn, totalCents: 80000 })).json();
    await A('POST', `/producao/solicitacoes/${s.id}/cotacoes/${c.id}/escolher`);
    const o = (await A('POST', '/producao/pedidos', { requestId: s.id, saleCents: 100000 })).json();
    expect(o).toMatchObject({ status: 'aberta', supplierId: forn, quoteId: c.id, saleCents: 100000, title: 'Adesivagem de frota' });
    expect((await A('POST', '/producao/pedidos', { requestId: s.id })).statusCode).toBe(409);
  });

  it('custos, margem e despesa no financeiro gerada uma única vez', async () => {
    const s = await solicitacao();
    const forn = await pessoa(orgA, ['fornecedor']);
    const c = (await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: forn, totalCents: 70000 })).json();
    await A('POST', `/producao/solicitacoes/${s.id}/cotacoes/${c.id}/escolher`);
    const o = (await A('POST', '/producao/pedidos', { requestId: s.id, saleCents: 100000 })).json();
    const c1 = (await A('POST', `/producao/pedidos/${o.id}/custos`, { description: 'Material', amountCents: 50000, incurredOn: '2026-10-10' })).json();
    await A('POST', `/producao/pedidos/${o.id}/custos`, { description: 'Mão de obra', amountCents: 25000 });
    const r = (await A('GET', `/producao/pedidos/${o.id}`)).json();
    expect(r).toMatchObject({ custoCents: 75000, margemCents: 25000, percentual: 25 });

    const despesa = (await A('POST', `/producao/custos/${c1.id}/gerar-despesa`, { dueDate: '2099-02-10' })).json();
    expect(despesa).toMatchObject({ kind: 'despesa', status: 'aberto', amountCents: 50000, partyId: forn, relatedKind: 'producao', relatedRef: o.number, competenceDate: '2026-10-10', dueDate: '2099-02-10' });
    const de_novo = await A('POST', `/producao/custos/${c1.id}/gerar-despesa`, { dueDate: '2099-02-10' });
    expect(de_novo.statusCode).toBe(409);
    expect(de_novo.json().error).toMatch(/já gerou uma despesa/);
    expect((await A('GET', `/producao/pedidos`)).json().items.find((x: { id: string }) => x.id === o.id)).toMatchObject({ custoCents: 75000, margemCents: 25000 });
  });

  it('pedido sem venda informada: margem negativa e % nula (não vira 0 nem 100)', async () => {
    const s = await solicitacao();
    const forn = await pessoa(orgA, ['fornecedor']);
    const c = (await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: forn, totalCents: 100 })).json();
    await A('POST', `/producao/solicitacoes/${s.id}/cotacoes/${c.id}/escolher`);
    const o = (await A('POST', '/producao/pedidos', { requestId: s.id })).json();
    await A('POST', `/producao/pedidos/${o.id}/custos`, { description: 'Custo', amountCents: 4000 });
    expect((await A('GET', `/producao/pedidos/${o.id}`)).json()).toMatchObject({ margemCents: -4000, percentual: null });
  });

  it('pedido cancelado não recebe custo; transições respeitam a ordem', async () => {
    const s = await solicitacao();
    const forn = await pessoa(orgA, ['fornecedor']);
    const c = (await A('POST', `/producao/solicitacoes/${s.id}/cotacoes`, { supplierId: forn, totalCents: 100 })).json();
    await A('POST', `/producao/solicitacoes/${s.id}/cotacoes/${c.id}/escolher`);
    const o = (await A('POST', '/producao/pedidos', { requestId: s.id })).json();
    expect((await A('POST', `/producao/pedidos/${o.id}/status`, { status: 'entregue' })).statusCode).toBe(409);
    expect((await A('POST', `/producao/pedidos/${o.id}/status`, { status: 'em_producao' })).statusCode).toBe(200);
    expect((await A('POST', `/producao/pedidos/${o.id}/status`, { status: 'cancelada' })).statusCode).toBe(200);
    expect((await A('POST', `/producao/pedidos/${o.id}/custos`, { description: 'x', amountCents: 1 })).statusCode).toBe(409);
  });

  it('ISOLAMENTO: outra organização não vê nem mexe na produção', async () => {
    const s = await solicitacao();
    expect((await chamar(orgB, 'GET', `/producao/solicitacoes/${s.id}/cotacoes`)).statusCode).toBe(404);
    expect((await chamar(orgB, 'POST', `/producao/solicitacoes/${s.id}/cancelar`)).statusCode).toBe(404);
    expect((await chamar(orgB, 'POST', '/producao/pedidos', { requestId: s.id })).statusCode).toBe(404);
  });
});

describe.skipIf(!url)('relatórios', () => {
  const R = (c: string) => chamar(orgR, 'GET', c);
  const lanc = (b: Record<string, unknown>) => chamar(orgR, 'POST', '/financeiro/lancamentos', { kind: 'receita', description: 'Receita', amountCents: 10000, dueDate: '2099-06-10', ...b });

  it('organização vazia: zeros, sem aviso', async () => {
    const v = (await R('/visao-geral')).json();
    expect(v).toMatchObject({ receita: { recebida: 0, aberta: 0 }, historicoParcial: false, aviso: null, saldo: { totalCents: 0, contasSemSaldoInicial: 0 } });
  });

  it('receita sem nenhuma despesa traz o AVISO de histórico parcial; com despesa, o aviso some', async () => {
    const conta = (await chamar(orgR, 'POST', '/financeiro/contas', { name: 'Caixa R', openingBalanceCents: null })).json().id;
    const [vencida, futura, cancelada] = [(await lanc({ amountCents: 10000, dueDate: '2020-01-10' })).json().items[0], (await lanc({ amountCents: 5000 })).json().items[0], (await lanc({ amountCents: 99999 })).json().items[0]];
    await chamar(orgR, 'POST', `/financeiro/lancamentos/${cancelada.id}/cancelar`, { motivo: 'Cliente desistiu' });
    await chamar(orgR, 'POST', `/financeiro/lancamentos/${futura.id}/baixar`, { accountId: conta, paidOn: '2026-10-22' });

    const v = (await R('/visao-geral')).json();
    expect(v.receita).toEqual({ recebida: 5000, aberta: 10000 });
    expect(v.cancelado.receita).toBe(99999);
    expect(v.vencidos.receita).toEqual({ quantidade: 1, totalCents: 10000 });
    expect(v.saldo).toMatchObject({ contasComSaldo: 0, contasSemSaldoInicial: 1 });
    expect(v.historicoParcial).toBe(true);
    expect(v.aviso).toBe('Histórico importado parcialmente. Indicadores financeiros consolidados podem não representar a operação completa.');

    await lanc({ kind: 'despesa', description: 'Aluguel', amountCents: 3000 });
    const depois = (await R('/visao-geral')).json();
    expect(depois).toMatchObject({ historicoParcial: false, aviso: null });
    expect(depois.despesa.aberta).toBe(3000);
    void vencida;
  });

  it('importação pendente aparece na visão geral', async () => {
    const [lote] = await db.insert(schema.geImportBatches).values({ organizationId: orgR, kind: 'lancamentos', fileName: 'x.csv', sha256: Math.random().toString(16).slice(2).padEnd(64, '0') }).returning();
    await db.insert(schema.geImportRows).values({ organizationId: orgR, batchId: lote!.id, rowNo: 2, sourceKey: 'k1', raw: {}, normalized: {}, status: 'precisa_vinculo' });
    expect((await R('/visao-geral')).json().importacaoPendente).toEqual({ linhas: 1, lotes: 1 });
  });

  it('resultado por categoria: competência, sem cancelado, "Sem categoria" e aproximações declaradas', async () => {
    const cat = (await chamar(orgR, 'POST', '/financeiro/categorias', { name: 'Serviços', kind: 'receita' })).json().id;
    await lanc({ description: 'Com competência', amountCents: 20000, dueDate: '2098-02-10', competenceDate: '2098-01-15', categoryId: cat });
    await lanc({ description: 'Sem competência', amountCents: 7000, dueDate: '2098-01-20' });
    const cancel = (await lanc({ description: 'Cancelada no período', amountCents: 88888, dueDate: '2098-01-25', competenceDate: '2098-01-25' })).json().items[0];
    await chamar(orgR, 'POST', `/financeiro/lancamentos/${cancel.id}/cancelar`, { motivo: 'x' });
    const r = (await R('/relatorios/resultado?de=2098-01-01&ate=2098-01-31')).json();
    expect(r.receitas).toEqual([{ categoria: 'Serviços', quantidade: 1, totalCents: 20000 }, { categoria: 'Sem categoria', quantidade: 1, totalCents: 7000 }]);
    expect(r).toMatchObject({ receitaTotalCents: 27000, despesaTotalCents: 0, resultadoCents: 27000, lancamentosPorVencimento: 1, historicoParcial: true });
    expect(r.aviso).toMatch(/Histórico importado parcialmente/);
  });

  it('atraso por faixa soma o aberto e lista quem mais deve', async () => {
    const r = (await R('/relatorios/atraso?kind=receita')).json();
    expect(r.faixas.mais_de_90.quantidade).toBeGreaterThanOrEqual(1);
    expect(r.faixas.a_vencer.quantidade).toBeGreaterThanOrEqual(1);
    expect(r.totalCents).toBe(Object.values(r.faixas as Record<string, { totalCents: number }>).reduce((s, f) => s + f.totalCents, 0));
    expect(r.maiores[0]).toHaveProperty('vencidoCents');
  });

  it('funil comercial e rentabilidade da produção respondem', async () => {
    expect((await chamar(orgA, 'GET', '/relatorios/funil-comercial')).json()).toHaveProperty('aprovada');
    const rent = (await chamar(orgA, 'GET', '/relatorios/rentabilidade-da-producao')).json().items;
    expect(rent.some((x: { percentual: number | null; vendaCents: number | null }) => x.vendaCents === 100000 && x.percentual === 25)).toBe(true);
  });

  it('CSV para planilha: BOM, ponto e vírgula, vírgula decimal e INJEÇÃO DE FÓRMULA neutralizada', async () => {
    await lanc({ description: '=HYPERLINK("http://mal.example","clique")', amountCents: 123456, dueDate: '2098-03-01' });
    await lanc({ description: 'Texto; com "aspas"', amountCents: 5, dueDate: '2098-03-02' });
    const r = await chamar(orgR, 'GET', '/relatorios/lancamentos.csv?from=2098-03-01&to=2098-03-31');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('lancamentos.csv');
    expect(r.body.startsWith('﻿Vencimento;Competência;Tipo;Situação')).toBe(true);
    expect(r.body).toContain(`'=HYPERLINK`);
    expect(r.body).not.toMatch(/;=HYPERLINK/);
    expect(r.body).toContain('1234,56');
    expect(r.body).toContain('"Texto; com ""aspas"""');
    expect(r.body).toContain(';0,05;');
    expect(estado.auditoria.map((e) => e.action)).toContain('gestao.relatorio.exportado');
  });

  it('o CSV respeita os filtros e a organização', async () => {
    const r = await chamar(orgB, 'GET', '/relatorios/lancamentos.csv?from=2098-03-01&to=2098-03-31');
    expect(r.body.split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});
