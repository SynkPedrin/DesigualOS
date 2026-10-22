import { type AnyPgColumn, bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { users } from './identity';
import { clients } from './clients';

/**
 * Gestão Empresarial: cadastros, financeiro, comercial, produção e importador.
 *
 * REGRAS QUE VALEM PARA TODAS AS TABELAS ge_*:
 *  - `organization_id` em toda linha; toda consulta filtra por ele.
 *  - DINHEIRO é inteiro em centavos (`bigint`, modo number: seguro até 9e15). Nunca float.
 *  - Lançamento confirmado NUNCA é apagado: cancela-se (com motivo) ou estorna-se no razão.
 *    O razão (`ge_ledger`) é só de inserção; correção é uma linha nova que aponta para a anterior.
 *  - Vencido NÃO é status guardado: é `aberto` com `due_date` no passado, calculado na leitura.
 *  - Dado ausente fica NULO. Nada aqui é preenchido por dedução.
 *  - Origem (`source` + `source_key`) torna a importação idempotente; reimportar não duplica.
 *
 * CHECKs (estados, valores positivos, quitado=data de pagamento) NÃO estão aqui: o drizzle-orm 0.33
 * ignora `check()` em silêncio. Elas vivem no fim de `0085_gestao_empresarial.sql` e o teste
 * `gestao-empresarial.constraints.test.ts` prova que o banco recusa dado inválido.
 *
 * Migração ADITIVA: só cria tabelas novas.
 */

const org = () => uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });
/** Centavos. Sempre inteiro. */
const centavos = (nome: string) => bigint(nome, { mode: 'number' });

// ── Cadastros ──────────────────────────────────────────────────────────────

/** Uma empresa ou pessoa. Cliente, fornecedor e veículo de mídia são PAPÉIS da mesma entidade. */
export const geParties = pgTable(
  'ge_parties',
  {
    ...idColumn,
    organizationId: org(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    /** Só dígitos. O original do arquivo fica em `rawDocument`. */
    document: text('document'),
    rawDocument: text('raw_document'),
    /** 'cpf' | 'cnpj' | 'outro'; nulo quando não há documento. */
    documentKind: text('document_kind'),
    /** Dígito verificador conferido. Nulo = sem documento para conferir. */
    documentValid: boolean('document_valid'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    state: text('state'),
    status: text('status').notNull().default('ativo'),
    notes: text('notes'),
    /** Vínculo EXPLÍCITO com o cliente do Desigual OS. Nunca preenchido por nome. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    source: text('source'),
    sourceKey: text('source_key'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index('ge_parties_org_idx').on(t.organizationId, t.status),
    docIdx: index('ge_parties_doc_idx').on(t.organizationId, t.document),
    nameIdx: index('ge_parties_name_idx').on(t.organizationId, t.name),
    sourceUq: uniqueIndex('ge_parties_source_uq').on(t.organizationId, t.source, t.sourceKey).where(sql`${t.sourceKey} is not null`),
  }),
);

export const gePartyRoles = pgTable(
  'ge_party_roles',
  {
    ...idColumn,
    organizationId: org(),
    partyId: uuid('party_id').notNull().references(() => geParties.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('ge_party_roles_uq').on(t.partyId, t.role),
    orgIdx: index('ge_party_roles_org_idx').on(t.organizationId, t.role),
  }),
);

/** Detalhe do papel `veiculo_midia`. O tipo é livre (outdoor, rádio, jornal...). */
export const geMediaVehicles = pgTable(
  'ge_media_vehicles',
  {
    ...idColumn,
    organizationId: org(),
    partyId: uuid('party_id').notNull().references(() => geParties.id, { onDelete: 'cascade' }),
    mediaType: text('media_type'),
    coverage: text('coverage'),
    ...timestampColumns,
  },
  (t) => ({ partyUq: uniqueIndex('ge_media_vehicles_party_uq').on(t.partyId) }),
);

/** Catálogo de serviços vendidos ou contratados. Preço padrão é sugestão, nunca regra. */
export const geServices = pgTable(
  'ge_services',
  {
    ...idColumn,
    organizationId: org(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('venda'),
    unit: text('unit'),
    defaultPriceCents: centavos('default_price_cents'),
    active: boolean('active').notNull().default(true),
    ...timestampColumns,
  },
  (t) => ({
    orgIdx: index('ge_services_org_idx').on(t.organizationId, t.active),
  }),
);

// ── Financeiro: estrutura ──────────────────────────────────────────────────

export const geFinancialAccounts = pgTable(
  'ge_financial_accounts',
  {
    ...idColumn,
    organizationId: org(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('banco'),
    /** Saldo inicial em centavos, na data `openingDate`. Nulo = desconhecido (não vira zero). */
    openingBalanceCents: centavos('opening_balance_cents'),
    openingDate: date('opening_date'),
    active: boolean('active').notNull().default(true),
    ...timestampColumns,
  },
  (t) => ({
    nameUq: uniqueIndex('ge_financial_accounts_name_uq').on(t.organizationId, t.name),
  }),
);

export const geCategories = pgTable(
  'ge_categories',
  {
    ...idColumn,
    organizationId: org(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => geCategories.id, { onDelete: 'set null' }),
    active: boolean('active').notNull().default(true),
    ...timestampColumns,
  },
  (t) => ({
    nameUq: uniqueIndex('ge_categories_name_uq').on(t.organizationId, t.kind, t.name),
  }),
);

export const geCostCenters = pgTable(
  'ge_cost_centers',
  {
    ...idColumn,
    organizationId: org(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestampColumns,
  },
  (t) => ({ nameUq: uniqueIndex('ge_cost_centers_name_uq').on(t.organizationId, t.name) }),
);

/** Modelo de lançamento que se repete. As ocorrências são geradas como lançamentos comuns. */
export const geRecurrences = pgTable(
  'ge_recurrences',
  {
    ...idColumn,
    organizationId: org(),
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    amountCents: centavos('amount_cents').notNull(),
    categoryId: uuid('category_id').references(() => geCategories.id, { onDelete: 'set null' }),
    costCenterId: uuid('cost_center_id').references(() => geCostCenters.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => geFinancialAccounts.id, { onDelete: 'set null' }),
    frequency: text('frequency').notNull(),
    /** Dia do vencimento (1 a 31); em mês curto vale o último dia. */
    dayOfMonth: integer('day_of_month'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    /** Até onde as ocorrências já foram geradas. */
    generatedUntil: date('generated_until'),
    active: boolean('active').notNull().default(true),
    ...timestampColumns,
  },
  (t) => ({
    orgIdx: index('ge_recurrences_org_idx').on(t.organizationId, t.active),
  }),
);

// ── Financeiro: lançamentos e razão ────────────────────────────────────────

/** A receber ou a pagar. `valor` é o previsto; o que entrou ou saiu de fato mora no razão. */
export const geEntries = pgTable(
  'ge_entries',
  {
    ...idColumn,
    organizationId: org(),
    kind: text('kind').notNull(),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    /** Texto original do cedente/sacado quando ainda não há vínculo com um cadastro. */
    partyLabel: text('party_label'),
    description: text('description').notNull(),
    amountCents: centavos('amount_cents').notNull(),
    competenceDate: date('competence_date'),
    dueDate: date('due_date').notNull(),
    status: text('status').notNull().default('aberto'),
    paidAt: date('paid_at'),
    paidAmountCents: centavos('paid_amount_cents'),
    accountId: uuid('account_id').references(() => geFinancialAccounts.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => geCategories.id, { onDelete: 'set null' }),
    costCenterId: uuid('cost_center_id').references(() => geCostCenters.id, { onDelete: 'set null' }),
    installmentGroupId: uuid('installment_group_id'),
    installmentNo: integer('installment_no'),
    installmentTotal: integer('installment_total'),
    recurrenceId: uuid('recurrence_id').references(() => geRecurrences.id, { onDelete: 'set null' }),
    docNumber: text('doc_number'),
    /** 'proposta' | 'producao' | 'midia' | ...: referência ao registro de origem, sem chave estrangeira. */
    relatedKind: text('related_kind'),
    relatedRef: text('related_ref'),
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    source: text('source'),
    sourceKey: text('source_key'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    dueIdx: index('ge_entries_due_idx').on(t.organizationId, t.kind, t.status, t.dueDate),
    partyIdx: index('ge_entries_party_idx').on(t.organizationId, t.partyId),
    compIdx: index('ge_entries_competence_idx').on(t.organizationId, t.competenceDate),
    groupIdx: index('ge_entries_group_idx').on(t.installmentGroupId),
    sourceUq: uniqueIndex('ge_entries_source_uq').on(t.organizationId, t.source, t.sourceKey).where(sql`${t.sourceKey} is not null`),
  }),
);

/**
 * RAZÃO: toda movimentação real de dinheiro. SÓ INSERÇÃO. Correção = linha nova com
 * `reversesId` apontando para a original (estorno). Saldo da conta = soma assinada do razão.
 */
export const geLedger = pgTable(
  'ge_ledger',
  {
    ...idColumn,
    organizationId: org(),
    accountId: uuid('account_id').notNull().references(() => geFinancialAccounts.id, { onDelete: 'restrict' }),
    entryId: uuid('entry_id').references(() => geEntries.id, { onDelete: 'restrict' }),
    /** 'recebimento' | 'pagamento' | 'transferencia' | 'estorno' | 'ajuste' */
    kind: text('kind').notNull(),
    /** Positivo entra, negativo sai. Nunca zero. */
    amountCents: centavos('amount_cents').notNull(),
    occurredOn: date('occurred_on').notNull(),
    transferId: uuid('transfer_id'),
    reversesId: uuid('reverses_id').references((): AnyPgColumn => geLedger.id, { onDelete: 'restrict' }),
    memo: text('memo'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountIdx: index('ge_ledger_account_idx').on(t.organizationId, t.accountId, t.occurredOn),
    entryIdx: index('ge_ledger_entry_idx').on(t.entryId),
    reversesUq: uniqueIndex('ge_ledger_reverses_uq').on(t.reversesId).where(sql`${t.reversesId} is not null`),
  }),
);

/** Linhas de extrato importadas para conciliação. Conciliar é apontar para uma linha do razão. */
export const geStatementLines = pgTable(
  'ge_statement_lines',
  {
    ...idColumn,
    organizationId: org(),
    accountId: uuid('account_id').notNull().references(() => geFinancialAccounts.id, { onDelete: 'cascade' }),
    postedOn: date('posted_on').notNull(),
    description: text('description'),
    amountCents: centavos('amount_cents').notNull(),
    /** Identificador estável da linha no extrato (ex.: FITID do OFX) ou hash dela. */
    externalKey: text('external_key').notNull(),
    ledgerId: uuid('ledger_id').references(() => geLedger.id, { onDelete: 'set null' }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUq: uniqueIndex('ge_statement_lines_key_uq').on(t.organizationId, t.accountId, t.externalKey),
    dateIdx: index('ge_statement_lines_date_idx').on(t.organizationId, t.accountId, t.postedOn),
    ledgerUq: uniqueIndex('ge_statement_lines_ledger_uq').on(t.ledgerId).where(sql`${t.ledgerId} is not null`),
  }),
);

// ── Comercial ──────────────────────────────────────────────────────────────

export const geProposals = pgTable(
  'ge_proposals',
  {
    ...idColumn,
    organizationId: org(),
    number: text('number').notNull(),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('rascunho'),
    validUntil: date('valid_until'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    source: text('source'),
    sourceKey: text('source_key'),
    ...timestampColumns,
  },
  (t) => ({
    numberUq: uniqueIndex('ge_proposals_number_uq').on(t.organizationId, t.number),
    orgIdx: index('ge_proposals_org_idx').on(t.organizationId, t.status),
    sourceUq: uniqueIndex('ge_proposals_source_uq').on(t.organizationId, t.source, t.sourceKey).where(sql`${t.sourceKey} is not null`),
  }),
);

export const geProposalItems = pgTable(
  'ge_proposal_items',
  {
    ...idColumn,
    organizationId: org(),
    proposalId: uuid('proposal_id').notNull().references(() => geProposals.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => geServices.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: centavos('unit_price_cents').notNull(),
    discountCents: centavos('discount_cents').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    proposalIdx: index('ge_proposal_items_proposal_idx').on(t.proposalId, t.position),
  }),
);

export const geContracts = pgTable(
  'ge_contracts',
  {
    ...idColumn,
    organizationId: org(),
    number: text('number').notNull(),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    proposalId: uuid('proposal_id').references(() => geProposals.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('rascunho'),
    totalCents: centavos('total_cents').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    numberUq: uniqueIndex('ge_contracts_number_uq').on(t.organizationId, t.number),
  }),
);

export const geSalesOrders = pgTable(
  'ge_sales_orders',
  {
    ...idColumn,
    organizationId: org(),
    number: text('number').notNull(),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    proposalId: uuid('proposal_id').references(() => geProposals.id, { onDelete: 'set null' }),
    contractId: uuid('contract_id').references(() => geContracts.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('aberto'),
    totalCents: centavos('total_cents').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    numberUq: uniqueIndex('ge_sales_orders_number_uq').on(t.organizationId, t.number),
  }),
);

// ── Produção ───────────────────────────────────────────────────────────────

export const geProductionRequests = pgTable(
  'ge_production_requests',
  {
    ...idColumn,
    organizationId: org(),
    number: text('number').notNull(),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('aberta'),
    dueOn: date('due_on'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    numberUq: uniqueIndex('ge_production_requests_number_uq').on(t.organizationId, t.number),
  }),
);

/** Cotação de um fornecedor para uma solicitação. Comparar cotações é o ponto. */
export const geProductionQuotes = pgTable(
  'ge_production_quotes',
  {
    ...idColumn,
    organizationId: org(),
    requestId: uuid('request_id').notNull().references(() => geProductionRequests.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => geParties.id, { onDelete: 'set null' }),
    totalCents: centavos('total_cents').notNull(),
    leadTimeDays: integer('lead_time_days'),
    status: text('status').notNull().default('recebida'),
    notes: text('notes'),
    ...timestampColumns,
  },
  (t) => ({
    requestIdx: index('ge_production_quotes_request_idx').on(t.requestId),
  }),
);

export const geProductionOrders = pgTable(
  'ge_production_orders',
  {
    ...idColumn,
    organizationId: org(),
    number: text('number').notNull(),
    requestId: uuid('request_id').references(() => geProductionRequests.id, { onDelete: 'set null' }),
    quoteId: uuid('quote_id').references(() => geProductionQuotes.id, { onDelete: 'set null' }),
    supplierId: uuid('supplier_id').references(() => geParties.id, { onDelete: 'set null' }),
    partyId: uuid('party_id').references(() => geParties.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('aberta'),
    /** Valor cobrado do cliente, se houver. Custo real mora em `ge_production_costs`. */
    saleCents: centavos('sale_cents'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    numberUq: uniqueIndex('ge_production_orders_number_uq').on(t.organizationId, t.number),
  }),
);

export const geProductionCosts = pgTable(
  'ge_production_costs',
  {
    ...idColumn,
    organizationId: org(),
    orderId: uuid('order_id').notNull().references(() => geProductionOrders.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amountCents: centavos('amount_cents').notNull(),
    /** Despesa gerada no financeiro a partir deste custo, quando houver. */
    entryId: uuid('entry_id').references(() => geEntries.id, { onDelete: 'set null' }),
    incurredOn: date('incurred_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('ge_production_costs_order_idx').on(t.orderId),
  }),
);

// ── Importador ─────────────────────────────────────────────────────────────

/** Um arquivo importado. O mesmo sha256 não entra duas vezes. */
export const geImportBatches = pgTable(
  'ge_import_batches',
  {
    ...idColumn,
    organizationId: org(),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').notNull().default('em_staging'),
    totals: jsonb('totals').$type<Record<string, number>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fileUq: uniqueIndex('ge_import_batches_file_uq').on(t.organizationId, t.kind, t.sha256),
  }),
);

/** Linha em staging. Nada daqui vira registro final sem passar por `aplicar`. */
export const geImportRows = pgTable(
  'ge_import_rows',
  {
    ...idColumn,
    organizationId: org(),
    batchId: uuid('batch_id').notNull().references(() => geImportBatches.id, { onDelete: 'cascade' }),
    rowNo: integer('row_no').notNull(),
    sourceKey: text('source_key').notNull(),
    raw: jsonb('raw').$type<Record<string, string | null>>().notNull(),
    normalized: jsonb('normalized').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull(),
    issues: jsonb('issues').$type<string[]>().notNull().default([]),
    /** Decisão humana: com qual cadastro esta linha se liga (cedente de lançamento, duplicado). */
    resolvedPartyId: uuid('resolved_party_id').references(() => geParties.id, { onDelete: 'set null' }),
    /** Registro final criado a partir desta linha. */
    appliedId: uuid('applied_id'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    batchIdx: index('ge_import_rows_batch_idx').on(t.batchId, t.status),
    keyUq: uniqueIndex('ge_import_rows_key_uq').on(t.batchId, t.sourceKey),
  }),
);
