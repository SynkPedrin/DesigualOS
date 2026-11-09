import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ErroDeNegocio } from './http';
import { margem, podeTransitar, TRANSICOES_PEDIDO_DE_PRODUCAO, TRANSICOES_SOLICITACAO } from './dominio/comercial';
import { numeroSeguinte } from './servico-comercial';
import type { Ator } from './servico-financeiro';

const { geProductionRequests: sol, geProductionQuotes: cot, geProductionOrders: ped, geProductionCosts: custo, geParties, gePartyRoles, geEntries } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PAPEIS_DE_FORNECEDOR = ['fornecedor', 'veiculo_midia', 'prestador'];

async function exigirPessoa(tx: Tx | typeof db, org: string, id: string | null | undefined) {
  if (!id) return;
  const [p] = await tx.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.id, id), eq(geParties.organizationId, org))).limit(1);
  if (!p) throw new ErroDeNegocio(404, 'Cadastro não encontrado.');
}

async function exigirFornecedor(tx: Tx, org: string, id: string) {
  await exigirPessoa(tx, org, id);
  const papeis = await tx.select({ r: gePartyRoles.role }).from(gePartyRoles).where(eq(gePartyRoles.partyId, id));
  if (!papeis.some((p) => PAPEIS_DE_FORNECEDOR.includes(p.r))) throw new ErroDeNegocio(409, 'Este cadastro não tem o papel de fornecedor, veículo de mídia ou prestador.');
}

export async function criarSolicitacao(ator: Ator, d: { partyId?: string | null | undefined; title: string; description?: string | null | undefined; dueOn?: string | null | undefined }) {
  return db.transaction(async (tx) => {
    await exigirPessoa(tx, ator.organizationId, d.partyId);
    const number = await numeroSeguinte(tx, ator.organizationId, 'solicitacao');
    const [s] = await tx.insert(sol).values({ organizationId: ator.organizationId, number, partyId: d.partyId ?? null, title: d.title, description: d.description ?? null, dueOn: d.dueOn ?? null, createdBy: ator.userId }).returning();
    return s!;
  });
}

export async function listarSolicitacoes(org: string, f: { status?: string | undefined; page: number; pageSize: number }) {
  const onde = and(eq(sol.organizationId, org), f.status ? eq(sol.status, f.status) : undefined);
  const [[tot], items] = await Promise.all([db.select({ n: count() }).from(sol).where(onde), db.select().from(sol).where(onde).orderBy(desc(sol.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize)]);
  return { total: tot?.n ?? 0, items };
}

async function solicitacao(tx: Tx, org: string, id: string) {
  const [s] = await tx.select().from(sol).where(and(eq(sol.id, id), eq(sol.organizationId, org))).for('update').limit(1);
  if (!s) throw new ErroDeNegocio(404, 'Solicitação não encontrada.');
  return s;
}

export async function cancelarSolicitacao(ator: Ator, id: string) {
  return db.transaction(async (tx) => {
    const s = await solicitacao(tx, ator.organizationId, id);
    if (!podeTransitar(TRANSICOES_SOLICITACAO, s.status, 'cancelada')) throw new ErroDeNegocio(409, `Uma solicitação "${s.status}" não pode ser cancelada.`);
    const [r] = await tx.update(sol).set({ status: 'cancelada' }).where(eq(sol.id, id)).returning();
    return r!;
  });
}

export async function registrarCotacao(ator: Ator, requestId: string, d: { supplierId: string; totalCents: number; leadTimeDays?: number | null | undefined; notes?: string | null | undefined }) {
  return db.transaction(async (tx) => {
    const s = await solicitacao(tx, ator.organizationId, requestId);
    if (!['aberta', 'cotando'].includes(s.status)) throw new ErroDeNegocio(409, `Solicitação "${s.status}" não recebe cotações.`);
    await exigirFornecedor(tx, ator.organizationId, d.supplierId);
    const [c] = await tx.insert(cot).values({ organizationId: ator.organizationId, requestId, supplierId: d.supplierId, totalCents: d.totalCents, leadTimeDays: d.leadTimeDays ?? null, notes: d.notes ?? null }).returning();
    if (s.status === 'aberta') await tx.update(sol).set({ status: 'cotando' }).where(eq(sol.id, requestId));
    return c!;
  });
}

/** Cotações lado a lado, da mais barata para a mais cara, com a diferença para a menor. */
export async function compararCotacoes(org: string, requestId: string) {
  const [s] = await db.select().from(sol).where(and(eq(sol.id, requestId), eq(sol.organizationId, org))).limit(1);
  if (!s) throw new ErroDeNegocio(404, 'Solicitação não encontrada.');
  const linhas = await db
    .select({ q: cot, fornecedor: geParties.name })
    .from(cot)
    .leftJoin(geParties, eq(geParties.id, cot.supplierId))
    .where(eq(cot.requestId, requestId))
    .orderBy(asc(cot.totalCents), asc(cot.id));
  const menor = linhas[0]?.q.totalCents ?? null;
  return { solicitacao: s, cotacoes: linhas.map((l) => ({ ...l.q, fornecedor: l.fornecedor, diferencaParaMenorCents: menor === null ? null : l.q.totalCents - menor })) };
}

export async function escolherCotacao(ator: Ator, requestId: string, quoteId: string) {
  return db.transaction(async (tx) => {
    const s = await solicitacao(tx, ator.organizationId, requestId);
    if (s.status !== 'cotando') throw new ErroDeNegocio(409, s.status === 'aprovada' ? 'Esta solicitação já tem uma cotação escolhida.' : `Solicitação "${s.status}" não aceita escolha de cotação.`);
    const [q] = await tx.select().from(cot).where(and(eq(cot.id, quoteId), eq(cot.requestId, requestId), eq(cot.organizationId, ator.organizationId))).limit(1);
    if (!q) throw new ErroDeNegocio(404, 'Cotação não encontrada nesta solicitação.');
    await tx.update(cot).set({ status: 'descartada' }).where(and(eq(cot.requestId, requestId), ne(cot.id, quoteId)));
    const [escolhida] = await tx.update(cot).set({ status: 'escolhida' }).where(eq(cot.id, quoteId)).returning();
    await tx.update(sol).set({ status: 'aprovada' }).where(eq(sol.id, requestId));
    return escolhida!;
  });
}

export async function criarPedidoDeProducao(ator: Ator, d: { requestId: string; title?: string | undefined; saleCents?: number | null | undefined }) {
  return db.transaction(async (tx) => {
    const s = await solicitacao(tx, ator.organizationId, d.requestId);
    if (s.status !== 'aprovada') throw new ErroDeNegocio(409, 'Escolha uma cotação antes de abrir o pedido de produção.');
    const [q] = await tx.select().from(cot).where(and(eq(cot.requestId, d.requestId), eq(cot.status, 'escolhida'))).limit(1);
    if (!q) throw new ErroDeNegocio(409, 'Não há cotação escolhida para esta solicitação.');
    const [ja] = await tx.select({ id: ped.id }).from(ped).where(and(eq(ped.requestId, d.requestId), ne(ped.status, 'cancelada'))).limit(1);
    if (ja) throw new ErroDeNegocio(409, 'Esta solicitação já tem um pedido de produção.');
    const number = await numeroSeguinte(tx, ator.organizationId, 'producao');
    const [o] = await tx.insert(ped).values({ organizationId: ator.organizationId, number, requestId: d.requestId, quoteId: q.id, supplierId: q.supplierId, partyId: s.partyId, title: d.title ?? s.title, saleCents: d.saleCents ?? null, createdBy: ator.userId }).returning();
    return o!;
  });
}

export async function listarPedidosDeProducao(org: string, f: { status?: string | undefined; page: number; pageSize: number }) {
  const onde = and(eq(ped.organizationId, org), f.status ? eq(ped.status, f.status) : undefined);
  const [[tot], itens] = await Promise.all([
    db.select({ n: count() }).from(ped).where(onde),
    db
      .select({ o: ped, custo: sql<string>`coalesce((select sum(c.amount_cents) from ge_production_costs c where c.order_id = ge_production_orders.id), 0)::text` })
      .from(ped)
      .where(onde)
      .orderBy(desc(ped.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
  ]);
  return { total: tot?.n ?? 0, items: itens.map((x) => ({ ...x.o, custoCents: Number(x.custo), ...margem(x.o.saleCents, Number(x.custo)) })) };
}

async function pedido(tx: Tx, org: string, id: string) {
  const [o] = await tx.select().from(ped).where(and(eq(ped.id, id), eq(ped.organizationId, org))).for('update').limit(1);
  if (!o) throw new ErroDeNegocio(404, 'Pedido de produção não encontrado.');
  return o;
}

export async function mudarStatusPedidoDeProducao(ator: Ator, id: string, para: string) {
  return db.transaction(async (tx) => {
    const o = await pedido(tx, ator.organizationId, id);
    if (!podeTransitar(TRANSICOES_PEDIDO_DE_PRODUCAO, o.status, para)) throw new ErroDeNegocio(409, `Um pedido "${o.status}" não pode ir para "${para}".`);
    const [s] = await tx.update(ped).set({ status: para }).where(eq(ped.id, id)).returning();
    return s!;
  });
}

export async function adicionarCusto(ator: Ator, orderId: string, d: { description: string; amountCents: number; incurredOn?: string | null | undefined }) {
  return db.transaction(async (tx) => {
    const o = await pedido(tx, ator.organizationId, orderId);
    if (o.status === 'cancelada') throw new ErroDeNegocio(409, 'Pedido cancelado não recebe custos.');
    const [c] = await tx.insert(custo).values({ organizationId: ator.organizationId, orderId, description: d.description, amountCents: d.amountCents, incurredOn: d.incurredOn ?? null }).returning();
    return c!;
  });
}

export async function resumoDoPedidoDeProducao(org: string, id: string) {
  const [o] = await db.select().from(ped).where(and(eq(ped.id, id), eq(ped.organizationId, org))).limit(1);
  if (!o) throw new ErroDeNegocio(404, 'Pedido de produção não encontrado.');
  const custos = await db.select().from(custo).where(eq(custo.orderId, id)).orderBy(asc(custo.createdAt));
  const total = custos.reduce((s, c) => s + c.amountCents, 0);
  return { pedido: o, custos, custoCents: total, ...margem(o.saleCents, total) };
}

/** Gera a DESPESA no financeiro a partir de um custo, uma só vez. A despesa nasce em aberto: pagar é outra ação. */
export async function gerarDespesaDoCusto(ator: Ator, costId: string, d: { dueDate: string; categoryId?: string | null | undefined; costCenterId?: string | null | undefined }) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(custo).where(and(eq(custo.id, costId), eq(custo.organizationId, ator.organizationId))).for('update').limit(1);
    if (!c) throw new ErroDeNegocio(404, 'Custo não encontrado.');
    if (c.entryId) throw new ErroDeNegocio(409, 'Este custo já gerou uma despesa no financeiro.');
    const [o] = await tx.select().from(ped).where(eq(ped.id, c.orderId)).limit(1);
    for (const [id, tabela, rotulo] of [[d.categoryId, schema.geCategories, 'Categoria'], [d.costCenterId, schema.geCostCenters, 'Centro de custo']] as const) {
      if (!id) continue;
      const [l] = await tx.select({ id: tabela.id }).from(tabela).where(and(eq(tabela.id, id), eq(tabela.organizationId, ator.organizationId))).limit(1);
      if (!l) throw new ErroDeNegocio(404, `${rotulo} não encontrado.`);
    }
    const [e] = await tx
      .insert(geEntries)
      .values({
        organizationId: ator.organizationId,
        kind: 'despesa',
        partyId: o!.supplierId,
        description: `${c.description} (${o!.number})`,
        amountCents: c.amountCents,
        competenceDate: c.incurredOn,
        dueDate: d.dueDate,
        categoryId: d.categoryId ?? null,
        costCenterId: d.costCenterId ?? null,
        relatedKind: 'producao',
        relatedRef: o!.number,
        source: 'custo_de_producao',
        sourceKey: c.id,
        createdBy: ator.userId,
      })
      .returning();
    await tx.update(custo).set({ entryId: e!.id }).where(eq(custo.id, costId));
    return e!;
  });
}

