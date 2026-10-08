import { bigint, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, date } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { agentNameEnum } from './enums';
import { clients } from './clients';
import { executions } from './execution';
import { users } from './identity';
import { conversations } from './conversation';
import { organizations } from './organizations';

export const tokenUsage = pgTable(
  'token_usage',
  {
    ...idColumn,
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /**
     * Fronteira de tenant direta (migração 0049). Antes o recorte saía só por
     * join com `executions` — custava um EXISTS por consulta de custo. Copiado
     * da execution no momento da gravação; backfill das linhas antigas em
     * apps/worker/scripts/backfill-cost-org.mts. `set null`: telemetria não
     * pode impedir a remoção de uma empresa.
     */
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    executionIdx: index('token_usage_execution_id_idx').on(table.executionId),
    organizationIdx: index('token_usage_organization_id_idx').on(table.organizationId),
  }),
);

/**
 * Agregação por modelo e período, usada nos gráficos de consumo do dashboard
 * (seção 11, mockup 1). Recalculada periodicamente pelo Token & Cost Engine.
 */
export const modelUsage = pgTable('model_usage', {
  ...idColumn,
  model: text('model').notNull(),
  agent: agentNameEnum('agent'),
  totalInputTokens: bigint('total_input_tokens', { mode: 'number' }).notNull().default(0),
  totalOutputTokens: bigint('total_output_tokens', { mode: 'number' }).notNull().default(0),
  totalCost: numeric('total_cost', { precision: 12, scale: 6 }).notNull().default('0'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const costRecords = pgTable(
  'cost_records',
  {
    ...idColumn,
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Fronteira de tenant direta (migração 0049): derivada da execution, com
     * fallback para a empresa do cliente — mesma precedência de
     * `organizacaoDaEscrita` em packages/auth. Backfill das linhas antigas em
     * apps/worker/scripts/backfill-cost-org.mts. `set null` como os demais
     * vínculos desta tabela: custo gravado não pode impedir remoção de
     * empresa, cliente ou pessoa.
     */
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    agent: agentNameEnum('agent'),
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 6 }).notNull(),
    // Decisão de arquitetura: custos sempre em USD (é como os LLMs cobram).
    // Todo insert real já passa 'USD' explícito (cost-service.ts); o default
    // era 'BRL' por engano - nunca atingido hoje, mas uma armadilha pro
    // primeiro insert futuro que esquecer de passar currency.
    currency: text('currency').notNull().default('USD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index('cost_records_client_id_idx').on(table.clientId),
    userIdx: index('cost_records_user_id_idx').on(table.userId),
    executionIdx: index('cost_records_execution_id_idx').on(table.executionId),
    organizationIdx: index('cost_records_organization_id_idx').on(table.organizationId),
  }),
);

export const economyRecords = pgTable('economy_records', {
  ...idColumn,
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id, { onDelete: 'cascade' }),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }).notNull(),
  actualCost: numeric('actual_cost', { precision: 12, scale: 6 }).notNull(),
  savedAmount: numeric('saved_amount', { precision: 12, scale: 6 }).notNull(),
  savedPercentage: numeric('saved_percentage', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ledger de uso da OpenAI (missão de release OpenAI + ClickUp MCP, seção
 * 11). Diferente de `cost_records` (genérico, um valor em USD por evento,
 * qualquer provider): esta tabela grava o USO REAL retornado pela OpenAI
 * (input/cached/output tokens, seção 10 sobre prompt caching) por chamada,
 * o suficiente pra reconstruir gasto diário/mensal/por-agente/por-modelo
 * sem depender de estimativa pré-request (seção 11: "custo deve ser
 * computado do uso real, não de estimativa").
 *
 * `organizationId`/`conversationId` ficam nullable de propósito: nem toda
 * chamada nasce dentro de uma conversa (ex: automação) ou tem organização
 * resolvida no momento da gravação; perder a linha de custo por causa disso
 * seria pior que gravar com FK parcial.
 *
 * ESTADO REAL, conferido em 01/10/2026: NADA escreve nesta tabela. O writer
 * (`recordOpenAIUsage` em packages/openai-provider/src/ledger.ts) existe e não é
 * chamado por nenhum caminho de execução — o gasto por tenant hoje sai de
 * `cost_records`/`token_usage` (organization_id desde a migração 0049). Fica
 * como está de propósito: reviver o ledger é uma decisão de produto (uso real
 * medido vs. estimado), não um detalhe desta fundação.
 */
export const aiUsageLedger = pgTable(
  'ai_usage_ledger',
  {
    ...idColumn,
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    agent: agentNameEnum('agent'),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    /** 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol' | outro provider futuro. Texto livre de propósito. */
    model: text('model').notNull(),
    provider: text('provider').notNull().default('openai'),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull(),
    /** 'chat' | 'tool_planning' | 'creative' | 'classification' etc — natureza da chamada, não o agente. */
    requestType: text('request_type').notNull(),
    toolSteps: integer('tool_steps').notNull().default(0),
    /** Metadados livres (ex: modelo pedido vs. modelo servido após downgrade de orçamento). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('ai_usage_ledger_created_at_idx').on(table.createdAt),
    orgCreatedAtIdx: index('ai_usage_ledger_org_created_at_idx').on(table.organizationId, table.createdAt),
    agentIdx: index('ai_usage_ledger_agent_idx').on(table.agent),
    modelIdx: index('ai_usage_ledger_model_idx').on(table.model),
    conversationIdx: index('ai_usage_ledger_conversation_id_idx').on(table.conversationId),
  }),
);
