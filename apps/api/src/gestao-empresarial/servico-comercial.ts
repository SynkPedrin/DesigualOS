import { and, asc, count, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ErroDeNegocio, semUndefined, type Parcial } from './http';
import { podeTransitar, proximoNumero, totalDaProposta, TRANSICOES_CONTRATO, TRANSICOES_PEDIDO_DE_VENDA, TRANSICOES_PROPOSTA, type ItemDeProposta } from './dominio/comercial';
import { gerarParcelas } from './dominio/parcelas';
import type { Ator } from './servico-financeiro';

const { geProposals, geProposalItems, geContracts, geSalesOrders, geParties, geEntries } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Próximo número da série, sem repetir mesmo com duas criações ao mesmo tempo (trava por organização e série). */
export async function numeroSeguinte(tx: Tx, org: string, serie: 'proposta' | 'contrato' | 'pedido' | 'solicitacao' | 'producao') {
  const cfg = {
    proposta: ['P', geProposals],
    contrato: ['C', geContracts],
    pedido: ['V', geSalesOrders],
    solicitacao: ['S', schema.geProductionRequests],
    producao: ['O', schema.geProductionOrders],
  } as const;
  const [prefixo, tabela] = cfg[serie];
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${org + ':' + serie}))`);
  const [ultimo] = await tx.select({ n: tabela.number }).from(tabela).where(eq(tabela.organizationId, org)).orderBy(desc(sql`length(${tabela.number})`), desc(tabela.number)).limit(1);
  return proximoNumero(prefixo, ultimo?.n ?? null);
}

async function exigirPessoa(tx: Tx | typeof db, org: string, id: string | null | undefined, rotulo = 'Cadastro') {
  if (!id) return;
  const [p] = await tx.select({ id: geParties.id }).from(geParties).where(and(eq(geParties.id, id), eq(geParties.organizationId, org))).limit(1);
  if (!p) throw new ErroDeNegocio(404, `${rotulo} não encontrado.`);
}

export interface ItemEntrada {
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  serviceId?: string | null | undefined;
}

async function gravarItens(tx: Tx, org: string, proposalId: string, itens: ItemEntrada[]) {
  const total = totalDaProposta(itens);
  const servicos = [...new Set(itens.map((i) => i.serviceId).filter((s): s is string => !!s))];
  if (servicos.length) {
    const achados = await tx.select({ id: schema.geServices.id }).from(schema.geServices).where(and(eq(schema.geServices.organizationId, org), inArray(schema.geServices.id, servicos)));
    if (achados.length !== servicos.length) throw new ErroDeNegocio(404, 'Serviço não encontrado.');
  }
  await tx.delete(geProposalItems).where(eq(geProposalItems.proposalId, proposalId));
  if (itens.length) await tx.insert(geProposalItems).values(itens.map((i, p) => ({ organizationId: org, proposalId, serviceId: i.serviceId ?? null, description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents, position: p })));
  return total;
}

export async function criarProposta(ator: Ator, d: { partyId?: string | null | undefined; title: string; validUntil?: string | null | undefined; notes?: string | null | undefined; items: ItemEntrada[] }) {
  return db.transaction(async (tx) => {
    await exigirPessoa(tx, ator.organizationId, d.partyId);
    const number = await numeroSeguinte(tx, ator.organizationId, 'proposta');
    const [p] = await tx.insert(geProposals).values({ organizationId: ator.organizationId, number, partyId: d.partyId ?? null, title: d.title, validUntil: d.validUntil ?? null, notes: d.notes ?? null, createdBy: ator.userId }).returning();
    const totalCents = await gravarItens(tx, ator.organizationId, p!.id, d.items);
    return { ...p!, totalCents };
  });
}

export async function obterProposta(org: string, id: string) {
  const [p] = await db.select().from(geProposals).where(and(eq(geProposals.id, id), eq(geProposals.organizationId, org))).limit(1);
  if (!p) throw new ErroDeNegocio(404, 'Proposta não encontrada.');
  const items = await db.select().from(geProposalItems).where(eq(geProposalItems.proposalId, id)).orderBy(asc(geProposalItems.position));
  return { ...p, items, totalCents: totalDaProposta(items) };
}

export async function listarPropostas(org: string, f: { status?: string | undefined; partyId?: string | undefined; q?: string | undefined; page: number; pageSize: number }) {
  const filtros = [eq(geProposals.organizationId, org)];
  if (f.status) filtros.push(eq(geProposals.status, f.status));
  if (f.partyId) filtros.push(eq(geProposals.partyId, f.partyId));
  if (f.q) filtros.push(ilike(geProposals.title, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`));
  const onde = and(...filtros);
  const [[tot], items] = await Promise.all([
    db.select({ n: count() }).from(geProposals).where(onde),
    db
      .select({ p: geProposals, total: sql<string>`coalesce((select sum(i.quantity * i.unit_price_cents - i.discount_cents) from ge_proposal_items i where i.proposal_id = ge_proposals.id), 0)::text` })
      .from(geProposals)
      .where(onde)
      .orderBy(desc(geProposals.createdAt), asc(geProposals.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
  ]);
  return { total: tot?.n ?? 0, items: items.map((x) => ({ ...x.p, totalCents: Number(x.total) })) };
}

async function proposta(tx: Tx, org: string, id: string) {
  const [p] = await tx.select().from(geProposals).where(and(eq(geProposals.id, id), eq(geProposals.organizationId, org))).for('update').limit(1);
  if (!p) throw new ErroDeNegocio(404, 'Proposta não encontrada.');
  return p;
}

export async function editarProposta(ator: Ator, id: string, d: Parcial<{ partyId: string | null; title: string; validUntil: string | null; notes: string | null }> & { items?: ItemEntrada[] | undefined }) {
  return db.transaction(async (tx) => {
    const p = await proposta(tx, ator.organizationId, id);
    if (p.status !== 'rascunho') throw new ErroDeNegocio(409, 'Só uma proposta em rascunho pode ser editada. Volte-a para rascunho antes, se ainda não foi decidida.');
    if (d.partyId !== undefined) await exigirPessoa(tx, ator.organizationId, d.partyId);
    const { items, ...campos } = d;
    const [salva] = Object.keys(semUndefined(campos)).length ? await tx.update(geProposals).set(semUndefined(campos)).where(eq(geProposals.id, id)).returning() : [p];
    if (items) await gravarItens(tx, ator.organizationId, id, items);
    const lista = await tx.select().from(geProposalItems).where(eq(geProposalItems.proposalId, id)).orderBy(asc(geProposalItems.position));
    return { ...salva!, items: lista, totalCents: totalDaProposta(lista) };
  });
}

export async function mudarStatusProposta(ator: Ator, id: string, para: string) {
  return db.transaction(async (tx) => {
    const p = await proposta(tx, ator.organizationId, id);
    if (!podeTransitar(TRANSICOES_PROPOSTA, p.status, para)) throw new ErroDeNegocio(409, `Uma proposta "${p.status}" não pode ir para "${para}".`);
    if (para === 'enviada') {
      const itens = await tx.select().from(geProposalItems).where(eq(geProposalItems.proposalId, id));
      if (itens.length === 0 || totalDaProposta(itens) <= 0) throw new ErroDeNegocio(409, 'Uma proposta sem itens ou de valor zero não pode ser enviada.');
    }
    const [salva] = await tx.update(geProposals).set({ status: para }).where(eq(geProposals.id, id)).returning();
    return salva!;
  });
}

/** Contrato e pedido nascem de proposta APROVADA, e cada proposta gera no máximo um deles ativo. */
async function propostaAprovada(tx: Tx, org: string, id: string) {
  const p = await proposta(tx, org, id);
  if (p.status !== 'aprovada') throw new ErroDeNegocio(409, 'Só uma proposta aprovada pode gerar contrato ou pedido.');
  const itens = await tx.select().from(geProposalItems).where(eq(geProposalItems.proposalId, id));
  return { p, totalCents: totalDaProposta(itens) };
}

export async function criarContrato(ator: Ator, d: { proposalId?: string | null | undefined; partyId?: string | null | undefined; title?: string | undefined; totalCents?: number | undefined; startsOn?: string | null | undefined; endsOn?: string | null | undefined; notes?: string | null | undefined }) {
  return db.transaction(async (tx) => {
    let base: { partyId: string | null; title: string; totalCents: number } = { partyId: d.partyId ?? null, title: d.title ?? '', totalCents: d.totalCents ?? 0 };
    if (d.proposalId) {
      const { p, totalCents } = await propostaAprovada(tx, ator.organizationId, d.proposalId);
      const [ja] = await tx.select({ id: geContracts.id }).from(geContracts).where(and(eq(geContracts.proposalId, p.id), ne(geContracts.status, 'cancelado'))).limit(1);
      if (ja) throw new ErroDeNegocio(409, 'Esta proposta já tem um contrato.');
      base = { partyId: d.partyId ?? p.partyId, title: d.title ?? p.title, totalCents: d.totalCents ?? totalCents };
    } else if (!d.title || d.totalCents === undefined) throw new ErroDeNegocio(400, 'Sem proposta, informe título e valor do contrato.');
    await exigirPessoa(tx, ator.organizationId, base.partyId);
    const number = await numeroSeguinte(tx, ator.organizationId, 'contrato');
    const [c] = await tx.insert(geContracts).values({ organizationId: ator.organizationId, number, partyId: base.partyId, proposalId: d.proposalId ?? null, title: base.title, totalCents: base.totalCents, startsOn: d.startsOn ?? null, endsOn: d.endsOn ?? null, notes: d.notes ?? null, createdBy: ator.userId }).returning();
    return c!;
  });
}

export async function mudarStatusContrato(ator: Ator, id: string, para: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(geContracts).where(and(eq(geContracts.id, id), eq(geContracts.organizationId, ator.organizationId))).for('update').limit(1);
    if (!c) throw new ErroDeNegocio(404, 'Contrato não encontrado.');
    if (!podeTransitar(TRANSICOES_CONTRATO, c.status, para)) throw new ErroDeNegocio(409, `Um contrato "${c.status}" não pode ir para "${para}".`);
    const [s] = await tx.update(geContracts).set({ status: para }).where(eq(geContracts.id, id)).returning();
    return s!;
  });
}

export async function listarContratos(org: string, f: { status?: string | undefined; page: number; pageSize: number }) {
  const onde = and(eq(geContracts.organizationId, org), f.status ? eq(geContracts.status, f.status) : undefined);
  const [[tot], items] = await Promise.all([db.select({ n: count() }).from(geContracts).where(onde), db.select().from(geContracts).where(onde).orderBy(desc(geContracts.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize)]);
  return { total: tot?.n ?? 0, items };
}

export async function criarPedidoDeVenda(ator: Ator, d: { proposalId?: string | null | undefined; contractId?: string | null | undefined; partyId?: string | null | undefined; title?: string | undefined; totalCents?: number | undefined }) {
  return db.transaction(async (tx) => {
    let base = { partyId: d.partyId ?? null, title: d.title ?? '', totalCents: d.totalCents ?? 0 };
    if (d.proposalId) {
      const { p, totalCents } = await propostaAprovada(tx, ator.organizationId, d.proposalId);
      const [ja] = await tx.select({ id: geSalesOrders.id }).from(geSalesOrders).where(and(eq(geSalesOrders.proposalId, p.id), ne(geSalesOrders.status, 'cancelado'))).limit(1);
      if (ja) throw new ErroDeNegocio(409, 'Esta proposta já tem um pedido.');
      base = { partyId: d.partyId ?? p.partyId, title: d.title ?? p.title, totalCents: d.totalCents ?? totalCents };
    } else if (!d.title || d.totalCents === undefined) throw new ErroDeNegocio(400, 'Sem proposta, informe título e valor do pedido.');
    await exigirPessoa(tx, ator.organizationId, base.partyId);
    if (d.contractId) {
      const [c] = await tx.select({ id: geContracts.id }).from(geContracts).where(and(eq(geContracts.id, d.contractId), eq(geContracts.organizationId, ator.organizationId))).limit(1);
      if (!c) throw new ErroDeNegocio(404, 'Contrato não encontrado.');
    }
    const number = await numeroSeguinte(tx, ator.organizationId, 'pedido');
    const [o] = await tx.insert(geSalesOrders).values({ organizationId: ator.organizationId, number, partyId: base.partyId, proposalId: d.proposalId ?? null, contractId: d.contractId ?? null, title: base.title, totalCents: base.totalCents, createdBy: ator.userId }).returning();
    return o!;
  });
}

export async function listarPedidosDeVenda(org: string, f: { status?: string | undefined; page: number; pageSize: number }) {
  const onde = and(eq(geSalesOrders.organizationId, org), f.status ? eq(geSalesOrders.status, f.status) : undefined);
  const [[tot], items] = await Promise.all([db.select({ n: count() }).from(geSalesOrders).where(onde), db.select().from(geSalesOrders).where(onde).orderBy(desc(geSalesOrders.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize)]);
  return { total: tot?.n ?? 0, items };
}

export async function cancelarPedidoDeVenda(ator: Ator, id: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(geSalesOrders).where(and(eq(geSalesOrders.id, id), eq(geSalesOrders.organizationId, ator.organizationId))).for('update').limit(1);
    if (!o) throw new ErroDeNegocio(404, 'Pedido não encontrado.');
    if (!podeTransitar(TRANSICOES_PEDIDO_DE_VENDA, o.status, 'cancelado')) throw new ErroDeNegocio(409, o.status === 'faturado' ? 'Pedido faturado não se cancela: cancele os lançamentos gerados no financeiro.' : 'Este pedido já está cancelado.');
    const [s] = await tx.update(geSalesOrders).set({ status: 'cancelado' }).where(eq(geSalesOrders.id, id)).returning();
    return s!;
  });
}

/**
 * Faturar: o pedido vira contas a receber. Acontece UMA vez (o pedido passa a "faturado" na mesma
 * transação que cria os lançamentos), e as parcelas somam exatamente o total do pedido.
 */
export async function faturarPedido(ator: Ator, id: string, d: { parcelas: number; primeiroVencimento: string; categoryId?: string | null | undefined; accountId?: string | null | undefined; costCenterId?: string | null | undefined }) {
  const pedido = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(geSalesOrders).where(and(eq(geSalesOrders.id, id), eq(geSalesOrders.organizationId, ator.organizationId))).for('update').limit(1);
    if (!o) throw new ErroDeNegocio(404, 'Pedido não encontrado.');
    if (!podeTransitar(TRANSICOES_PEDIDO_DE_VENDA, o.status, 'faturado')) throw new ErroDeNegocio(409, o.status === 'faturado' ? 'Este pedido já foi faturado.' : 'Pedido cancelado não pode ser faturado.');
    if (o.totalCents <= 0) throw new ErroDeNegocio(409, 'Pedido de valor zero não gera cobrança.');
    const parcelas = gerarParcelas({ totalCentavos: o.totalCents, quantidade: d.parcelas, primeiroVencimento: d.primeiroVencimento });
    await exigirReferenciasDoFaturamento(tx, ator.organizationId, d, o.partyId);
    const grupo = crypto.randomUUID();
    const entradas = await tx
      .insert(geEntries)
      .values(
        parcelas.map((p) => ({
          organizationId: ator.organizationId,
          kind: 'receita',
          partyId: o.partyId,
          description: `${o.title} (${o.number})`,
          amountCents: p.valorCentavos,
          competenceDate: d.primeiroVencimento,
          dueDate: p.vencimento,
          categoryId: d.categoryId ?? null,
          accountId: d.accountId ?? null,
          costCenterId: d.costCenterId ?? null,
          installmentGroupId: grupo,
          installmentNo: p.numero,
          installmentTotal: p.total,
          relatedKind: 'pedido',
          relatedRef: o.number,
          source: 'pedido_de_venda',
          sourceKey: `${o.id}:${p.numero}`,
          createdBy: ator.userId,
        })),
      )
      .returning();
    await tx.update(geSalesOrders).set({ status: 'faturado' }).where(eq(geSalesOrders.id, id));
    return { pedido: { ...o, status: 'faturado' }, lancamentos: entradas };
  });
  return pedido;
}

async function exigirReferenciasDoFaturamento(tx: Tx, org: string, d: { categoryId?: string | null | undefined; accountId?: string | null | undefined; costCenterId?: string | null | undefined }, _party: string | null) {
  const checar = async (id: string | null | undefined, tabela: typeof schema.geCategories | typeof schema.geFinancialAccounts | typeof schema.geCostCenters, rotulo: string) => {
    if (!id) return;
    const [l] = await tx.select({ id: tabela.id }).from(tabela).where(and(eq(tabela.id, id), eq(tabela.organizationId, org))).limit(1);
    if (!l) throw new ErroDeNegocio(404, `${rotulo} não encontrado.`);
  };
  await checar(d.categoryId, schema.geCategories, 'Categoria');
  await checar(d.accountId, schema.geFinancialAccounts, 'Conta');
  await checar(d.costCenterId, schema.geCostCenters, 'Centro de custo');
}

