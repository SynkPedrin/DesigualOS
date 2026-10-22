import { and, asc, count, desc, eq, gte, ilike, isNull, lt, lte, ne, sql, sum } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ErroDeNegocio, semUndefined, type Parcial } from './http';
import { gerarParcelas } from './dominio/parcelas';
import { hojeEmSaoPaulo } from './dominio/datas';
import { situacaoDe } from './dominio/situacao';
import { ocorrenciasPendentes, type Frequencia } from './dominio/recorrencia';
import { sugerirConciliacao } from './dominio/conciliacao';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const { geEntries, geLedger, geFinancialAccounts, geCategories, geCostCenters, geParties, geRecurrences, geStatementLines } = schema;

export interface Ator {
  organizationId: string;
  userId: string;
}

/** Toda referência vinda do cliente precisa ser DA MESMA organização: id de outra empresa vale 404. */
async function exigirReferencias(ex: Executor, org: string, refs: { partyId?: string | null | undefined; categoryId?: string | null | undefined; costCenterId?: string | null | undefined; accountId?: string | null | undefined}) {
  const checar = async (id: string | null | undefined, tabela: typeof geParties | typeof geCategories | typeof geCostCenters | typeof geFinancialAccounts, rotulo: string) => {
    if (!id) return;
    const [linha] = await ex.select({ id: tabela.id }).from(tabela).where(and(eq(tabela.id, id), eq(tabela.organizationId, org))).limit(1);
    if (!linha) throw new ErroDeNegocio(404, `${rotulo} não encontrado.`);
  };
  await checar(refs.partyId, geParties, 'Cadastro');
  await checar(refs.categoryId, geCategories, 'Categoria');
  await checar(refs.costCenterId, geCostCenters, 'Centro de custo');
  await checar(refs.accountId, geFinancialAccounts, 'Conta');
}

export interface NovoLancamento {
  kind: 'receita' | 'despesa';
  description: string;
  amountCents: number;
  dueDate: string;
  competenceDate?: string | null | undefined;
  partyId?: string | null | undefined;
  partyLabel?: string | null | undefined;
  categoryId?: string | null | undefined;
  costCenterId?: string | null | undefined;
  accountId?: string | null | undefined;
  docNumber?: string | null | undefined;
  /** Se > 1, `amountCents` é o TOTAL e vira N parcelas mensais que somam exatamente isso. */
  parcelas?: number | undefined;
}

export async function criarLancamento(ator: Ator, entrada: NovoLancamento) {
  return db.transaction(async (tx) => {
    await exigirReferencias(tx, ator.organizationId, entrada);
    const base = {
      organizationId: ator.organizationId,
      kind: entrada.kind,
      description: entrada.description,
      competenceDate: entrada.competenceDate ?? null,
      partyId: entrada.partyId ?? null,
      partyLabel: entrada.partyLabel ?? null,
      categoryId: entrada.categoryId ?? null,
      costCenterId: entrada.costCenterId ?? null,
      accountId: entrada.accountId ?? null,
      docNumber: entrada.docNumber ?? null,
      createdBy: ator.userId,
    };
    if (!entrada.parcelas || entrada.parcelas === 1) {
      const [linha] = await tx.insert(geEntries).values({ ...base, amountCents: entrada.amountCents, dueDate: entrada.dueDate }).returning();
      return [linha!];
    }
    const grupo = crypto.randomUUID();
    const parcelas = gerarParcelas({ totalCentavos: entrada.amountCents, quantidade: entrada.parcelas, primeiroVencimento: entrada.dueDate });
    return tx
      .insert(geEntries)
      .values(parcelas.map((p) => ({ ...base, amountCents: p.valorCentavos, dueDate: p.vencimento, installmentGroupId: grupo, installmentNo: p.numero, installmentTotal: p.total })))
      .returning();
  });
}

async function carregarTravado(tx: Tx, org: string, id: string) {
  const [linha] = await tx.select().from(geEntries).where(and(eq(geEntries.id, id), eq(geEntries.organizationId, org))).for('update').limit(1);
  if (!linha) throw new ErroDeNegocio(404, 'Lançamento não encontrado.');
  return linha;
}

export async function editarLancamento(ator: Ator, id: string, mudancas: Parcial<Pick<NovoLancamento, 'description' | 'amountCents' | 'dueDate' | 'competenceDate' | 'partyId' | 'partyLabel' | 'categoryId' | 'costCenterId' | 'accountId' | 'docNumber'>>) {
  return db.transaction(async (tx) => {
    const atual = await carregarTravado(tx, ator.organizationId, id);
    if (atual.status !== 'aberto') throw new ErroDeNegocio(409, atual.status === 'quitado' ? 'Lançamento quitado não se edita: estorne a baixa primeiro.' : 'Lançamento cancelado não se edita.');
    await exigirReferencias(tx, ator.organizationId, mudancas);
    const [linha] = await tx.update(geEntries).set(semUndefined(mudancas)).where(eq(geEntries.id, id)).returning();
    return linha!;
  });
}

/** Baixa: o que entrou ou saiu de fato. Pode diferir do previsto (juros, desconto); o previsto fica intacto. */
export async function baixarLancamento(ator: Ator, id: string, dados: { accountId: string; paidOn: string; paidAmountCents?: number | undefined}) {
  return db.transaction(async (tx) => {
    const l = await carregarTravado(tx, ator.organizationId, id);
    if (l.status !== 'aberto') throw new ErroDeNegocio(409, l.status === 'quitado' ? 'Este lançamento já está quitado.' : 'Lançamento cancelado não pode ser baixado.');
    await exigirReferencias(tx, ator.organizationId, { accountId: dados.accountId });
    const pago = dados.paidAmountCents ?? l.amountCents;
    await tx.insert(geLedger).values({
      organizationId: ator.organizationId,
      accountId: dados.accountId,
      entryId: l.id,
      kind: l.kind === 'receita' ? 'recebimento' : 'pagamento',
      amountCents: l.kind === 'receita' ? pago : -pago,
      occurredOn: dados.paidOn,
      createdBy: ator.userId,
    });
    const [linha] = await tx
      .update(geEntries)
      .set({ status: 'quitado', paidAt: dados.paidOn, paidAmountCents: pago, accountId: dados.accountId })
      .where(eq(geEntries.id, l.id))
      .returning();
    return linha!;
  });
}

/**
 * Estorno: NÃO apaga a baixa. Insere no razão uma linha oposta para cada movimento ainda não
 * estornado do lançamento e o devolve a "aberto". O histórico fica inteiro: baixa + estorno.
 */
export async function estornarBaixa(ator: Ator, id: string, motivo: string) {
  return db.transaction(async (tx) => {
    const l = await carregarTravado(tx, ator.organizationId, id);
    if (l.status !== 'quitado') throw new ErroDeNegocio(409, 'Só um lançamento quitado tem baixa para estornar.');
    const ja = tx.select({ x: geLedger.reversesId }).from(geLedger).where(and(eq(geLedger.entryId, id), sql`${geLedger.reversesId} is not null`));
    const movimentos = await tx
      .select()
      .from(geLedger)
      .where(and(eq(geLedger.entryId, id), isNull(geLedger.reversesId), sql`${geLedger.id} not in (${ja})`));
    if (movimentos.length === 0) throw new ErroDeNegocio(409, 'Não há movimento a estornar neste lançamento.');
    const hoje = hojeEmSaoPaulo();
    await tx.insert(geLedger).values(
      movimentos.map((m) => ({
        organizationId: ator.organizationId,
        accountId: m.accountId,
        entryId: id,
        kind: 'estorno' as const,
        amountCents: -m.amountCents,
        occurredOn: hoje,
        reversesId: m.id,
        memo: motivo,
        createdBy: ator.userId,
      })),
    );
    const [linha] = await tx.update(geEntries).set({ status: 'aberto', paidAt: null, paidAmountCents: null }).where(eq(geEntries.id, id)).returning();
    return linha!;
  });
}

export async function cancelarLancamento(ator: Ator, id: string, motivo: string) {
  return db.transaction(async (tx) => {
    const l = await carregarTravado(tx, ator.organizationId, id);
    if (l.status === 'cancelado') throw new ErroDeNegocio(409, 'Este lançamento já está cancelado.');
    if (l.status === 'quitado') throw new ErroDeNegocio(409, 'Lançamento quitado não se cancela: estorne a baixa primeiro.');
    const [linha] = await tx.update(geEntries).set({ status: 'cancelado', cancelReason: motivo, cancelledAt: new Date() }).where(eq(geEntries.id, id)).returning();
    return linha!;
  });
}

export async function transferir(ator: Ator, dados: { fromAccountId: string; toAccountId: string; amountCents: number; occurredOn: string; memo?: string | undefined}) {
  if (dados.fromAccountId === dados.toAccountId) throw new ErroDeNegocio(400, 'A conta de origem e a de destino precisam ser diferentes.');
  return db.transaction(async (tx) => {
    await exigirReferencias(tx, ator.organizationId, { accountId: dados.fromAccountId });
    await exigirReferencias(tx, ator.organizationId, { accountId: dados.toAccountId });
    const transferId = crypto.randomUUID();
    const comum = { organizationId: ator.organizationId, kind: 'transferencia' as const, occurredOn: dados.occurredOn, transferId, memo: dados.memo ?? null, createdBy: ator.userId };
    const linhas = await tx
      .insert(geLedger)
      .values([
        { ...comum, accountId: dados.fromAccountId, amountCents: -dados.amountCents },
        { ...comum, accountId: dados.toAccountId, amountCents: dados.amountCents },
      ])
      .returning();
    return { transferId, linhas };
  });
}

/** Saldo = saldo inicial (se conhecido) + soma assinada do razão. Saldo inicial desconhecido NÃO vira zero. */
export async function saldosDasContas(organizationId: string) {
  const contas = await db.select().from(geFinancialAccounts).where(eq(geFinancialAccounts.organizationId, organizationId)).orderBy(asc(geFinancialAccounts.name));
  const somas = await db
    .select({ accountId: geLedger.accountId, total: sum(geLedger.amountCents) })
    .from(geLedger)
    .where(eq(geLedger.organizationId, organizationId))
    .groupBy(geLedger.accountId);
  const porConta = new Map(somas.map((s) => [s.accountId, Number(s.total ?? 0)]));
  return contas.map((c) => {
    const movimento = porConta.get(c.id) ?? 0;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      active: c.active,
      openingBalanceCents: c.openingBalanceCents,
      movementCents: movimento,
      balanceCents: c.openingBalanceCents === null ? null : c.openingBalanceCents + movimento,
    };
  });
}

export interface FiltroDeLancamentos {
  kind?: 'receita' | 'despesa' | undefined;
  situacao?: 'aberto' | 'vencido' | 'quitado' | 'cancelado' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  partyId?: string | undefined;
  q?: string | undefined;
  page: number;
  pageSize: number;
}

export async function listarLancamentos(organizationId: string, f: FiltroDeLancamentos, hoje = hojeEmSaoPaulo()) {
  const filtros = [eq(geEntries.organizationId, organizationId)];
  if (f.kind) filtros.push(eq(geEntries.kind, f.kind));
  if (f.situacao === 'vencido') filtros.push(eq(geEntries.status, 'aberto'), lt(geEntries.dueDate, hoje));
  else if (f.situacao === 'aberto') filtros.push(eq(geEntries.status, 'aberto'), gte(geEntries.dueDate, hoje));
  else if (f.situacao) filtros.push(eq(geEntries.status, f.situacao));
  if (f.from) filtros.push(gte(geEntries.dueDate, f.from));
  if (f.to) filtros.push(lte(geEntries.dueDate, f.to));
  if (f.partyId) filtros.push(eq(geEntries.partyId, f.partyId));
  if (f.q) filtros.push(ilike(geEntries.description, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`));
  const onde = and(...filtros);
  const [[tot], linhas] = await Promise.all([
    db.select({ n: count(), soma: sum(geEntries.amountCents) }).from(geEntries).where(onde),
    db.select().from(geEntries).where(onde).orderBy(desc(geEntries.dueDate), asc(geEntries.id)).limit(f.pageSize).offset((f.page - 1) * f.pageSize),
  ]);
  return {
    total: tot?.n ?? 0,
    somaCentavos: Number(tot?.soma ?? 0),
    items: linhas.map((l) => ({ ...l, situacao: situacaoDe(l, hoje) })),
  };
}

// ── Recorrências ───────────────────────────────────────────────────────────

export interface NovaRecorrencia {
  kind: 'receita' | 'despesa';
  description: string;
  amountCents: number;
  frequency: Frequencia;
  startDate: string;
  endDate?: string | null | undefined;
  dayOfMonth?: number | null | undefined;
  partyId?: string | null | undefined;
  categoryId?: string | null | undefined;
  costCenterId?: string | null | undefined;
  accountId?: string | null | undefined;
}

export async function criarRecorrencia(ator: Ator, e: NovaRecorrencia) {
  await exigirReferencias(db, ator.organizationId, e);
  const [linha] = await db
    .insert(geRecurrences)
    .values({
      organizationId: ator.organizationId,
      kind: e.kind,
      description: e.description,
      amountCents: e.amountCents,
      frequency: e.frequency,
      startDate: e.startDate,
      endDate: e.endDate ?? null,
      dayOfMonth: e.dayOfMonth ?? null,
      partyId: e.partyId ?? null,
      categoryId: e.categoryId ?? null,
      costCenterId: e.costCenterId ?? null,
      accountId: e.accountId ?? null,
    })
    .returning();
  return linha!;
}

/**
 * Gera os lançamentos que faltam até `ate`. IDEMPOTENTE em duas camadas: `generatedUntil` avança
 * e cada ocorrência tem chave de origem única (`recorrencia`, `<id>:<data>`), então duas execuções
 * simultâneas não duplicam: a segunda esbarra no índice único e é ignorada.
 */
export async function gerarRecorrencias(ator: Ator, ate: string, recorrenciaId?: string) {
  const modelos = await db
    .select()
    .from(geRecurrences)
    .where(and(eq(geRecurrences.organizationId, ator.organizationId), eq(geRecurrences.active, true), recorrenciaId ? eq(geRecurrences.id, recorrenciaId) : undefined));
  let criados = 0;
  for (const m of modelos) {
    const datas = ocorrenciasPendentes({ frequencia: m.frequency as Frequencia, inicio: m.startDate, fim: m.endDate, diaDoMes: m.dayOfMonth, geradoAte: m.generatedUntil }, ate);
    if (datas.length === 0) continue;
    await db.transaction(async (tx) => {
      const inseridos = await tx
        .insert(geEntries)
        .values(
          datas.map((d) => ({
            organizationId: ator.organizationId,
            kind: m.kind,
            description: m.description,
            amountCents: m.amountCents,
            dueDate: d,
            competenceDate: d,
            partyId: m.partyId,
            categoryId: m.categoryId,
            costCenterId: m.costCenterId,
            accountId: m.accountId,
            recurrenceId: m.id,
            source: 'recorrencia',
            sourceKey: `${m.id}:${d}`,
            createdBy: ator.userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: geEntries.id });
      criados += inseridos.length;
      await tx.update(geRecurrences).set({ generatedUntil: datas[datas.length - 1]! }).where(eq(geRecurrences.id, m.id));
    });
  }
  return { criados };
}

// ── Conciliação ────────────────────────────────────────────────────────────

export async function importarExtrato(ator: Ator, accountId: string, linhas: Array<{ postedOn: string; description?: string | undefined; amountCents: number; externalKey: string }>) {
  await exigirReferencias(db, ator.organizationId, { accountId });
  const inseridas = await db
    .insert(geStatementLines)
    .values(linhas.map((l) => ({ organizationId: ator.organizationId, accountId, postedOn: l.postedOn, description: l.description ?? null, amountCents: l.amountCents, externalKey: l.externalKey })))
    .onConflictDoNothing()
    .returning({ id: geStatementLines.id });
  return { recebidas: linhas.length, novas: inseridas.length, jaExistiam: linhas.length - inseridas.length };
}

export async function sugestoesDeConciliacao(organizationId: string, accountId: string) {
  const linhas = await db
    .select()
    .from(geStatementLines)
    .where(and(eq(geStatementLines.organizationId, organizationId), eq(geStatementLines.accountId, accountId), isNull(geStatementLines.ledgerId)))
    .orderBy(asc(geStatementLines.postedOn))
    .limit(500);
  const conciliados = db.select({ id: geStatementLines.ledgerId }).from(geStatementLines).where(sql`${geStatementLines.ledgerId} is not null`);
  const movimentos = await db
    .select()
    .from(geLedger)
    .where(and(eq(geLedger.organizationId, organizationId), eq(geLedger.accountId, accountId), sql`${geLedger.id} not in (${conciliados})`, isNull(geLedger.reversesId)))
    .limit(2000);
  const sugestoes = sugerirConciliacao(
    linhas.map((l) => ({ id: l.id, postedOn: l.postedOn, amountCents: l.amountCents })),
    movimentos.map((m) => ({ id: m.id, occurredOn: m.occurredOn, amountCents: m.amountCents })),
  );
  return { linhas, sugestoes };
}

export async function conciliar(ator: Ator, linhaId: string, ledgerId: string) {
  return db.transaction(async (tx) => {
    const [linha] = await tx.select().from(geStatementLines).where(and(eq(geStatementLines.id, linhaId), eq(geStatementLines.organizationId, ator.organizationId))).for('update').limit(1);
    if (!linha) throw new ErroDeNegocio(404, 'Linha de extrato não encontrada.');
    if (linha.ledgerId) throw new ErroDeNegocio(409, 'Esta linha já está conciliada.');
    const [mov] = await tx.select().from(geLedger).where(and(eq(geLedger.id, ledgerId), eq(geLedger.organizationId, ator.organizationId))).limit(1);
    if (!mov) throw new ErroDeNegocio(404, 'Movimento do razão não encontrado.');
    if (mov.accountId !== linha.accountId) throw new ErroDeNegocio(409, 'Extrato e movimento são de contas diferentes.');
    if (mov.amountCents !== linha.amountCents) throw new ErroDeNegocio(409, 'Os valores do extrato e do razão não são iguais.');
    const [uso] = await tx.select({ id: geStatementLines.id }).from(geStatementLines).where(and(eq(geStatementLines.ledgerId, ledgerId), ne(geStatementLines.id, linhaId))).limit(1);
    if (uso) throw new ErroDeNegocio(409, 'Este movimento já foi conciliado com outra linha.');
    const [salva] = await tx.update(geStatementLines).set({ ledgerId, reconciledAt: new Date() }).where(eq(geStatementLines.id, linhaId)).returning();
    return salva!;
  });
}

export async function desconciliar(ator: Ator, linhaId: string) {
  const [salva] = await db
    .update(geStatementLines)
    .set({ ledgerId: null, reconciledAt: null })
    .where(and(eq(geStatementLines.id, linhaId), eq(geStatementLines.organizationId, ator.organizationId)))
    .returning();
  if (!salva) throw new ErroDeNegocio(404, 'Linha de extrato não encontrada.');
  return salva;
}

