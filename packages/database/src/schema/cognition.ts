import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';
import { users } from './identity';
import { campaigns } from './knowledge-plane';

/**
 * cognition.ts — o que o sistema LEMBRA (L1) e o que os agentes COMPARTILHAM.
 *
 * A memória que existia era semântica (L2: preferência, regra, dossiê) e
 * organizacional (L3: ClickUp, vault). Faltava a camada do meio: o que
 * ACONTECEU e quando. Sem ela "o que conversamos ontem?" só podia ser
 * respondido relendo o histórico inteiro da conversa — e em conversa nova,
 * não podia ser respondido de jeito nenhum.
 */

/**
 * L1 — EPISÓDIO. Um acontecimento datado e com escopo, não a transcrição.
 *
 * Conversa não vira verdade automaticamente: o candidato é extraído, escopado,
 * deduplicado e só então persistido. Guardar toda mensagem como fato foi
 * descartado de propósito — é assim que memória vira ruído e que conversa fiada
 * de QA acaba sendo citada como decisão de cliente.
 */
export const agentEpisodes = pgTable(
  'agent_episodes',
  {
    ...idColumn,
    /** QUANDO aconteceu. É a coluna que sustenta "ontem", "esta semana". */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    agent: text('agent'),
    conversationId: uuid('conversation_id'),
    executionId: text('execution_id'),
    /** 'decision' | 'feedback' | 'preference' | 'delivery' | 'operational_change' | 'question' */
    eventType: text('event_type').notNull(),
    /** Uma frase. O que aconteceu, legível por humano. */
    summary: text('summary').notNull(),
    facts: jsonb('facts').$type<string[]>().notNull().default([]),
    decisions: jsonb('decisions').$type<string[]>().notNull().default([]),
    feedback: jsonb('feedback').$type<string[]>().notNull().default([]),
    /** Proveniência: de onde cada coisa veio. Sem isto não há "de onde tirou". */
    sourceRefs: jsonb('source_refs').$type<string[]>().notNull().default([]),
    importance: text('importance').notNull().default('0.500'),
    /**
     * ISOLAMENTO QA (regra dura): episódio de QA NUNCA é recuperado em produção.
     * O default é 'production' porque a origem esmagadora é operação real; o
     * caminho de QA marca explicitamente.
     */
    environment: text('environment').notNull().default('production'),
    /** Mesmo acontecimento contado duas vezes não vira dois episódios. */
    dedupeKey: text('dedupe_key'),
    ...timestampColumns,
  },
  (table) => ({
    tempoIdx: index('agent_episodes_occurred_at_idx').on(table.occurredAt),
    clienteIdx: index('agent_episodes_client_id_idx').on(table.clientId),
    usuarioIdx: index('agent_episodes_user_id_idx').on(table.userId),
    ambienteIdx: index('agent_episodes_environment_idx').on(table.environment),
    dedupe: unique('agent_episodes_dedupe_key_unique').on(table.dedupeKey),
  }),
);

/**
 * BLACKBOARD — estado compartilhado de UMA execução.
 *
 * Existe para que Bento e Otto trabalhem sobre o mesmo contexto sem recuperar
 * tudo de novo às cegas e sem duplicar verdade. Uma linha por execução; os
 * agentes leem e escrevem campos, nunca reescrevem a identidade do escopo.
 */
export const executionBlackboards = pgTable(
  'execution_blackboards',
  {
    ...idColumn,
    executionId: text('execution_id').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    objective: text('objective'),
    /** Fatos com evidência, acumulados pelos agentes da execução. */
    facts: jsonb('facts').$type<Array<{ text: string; sourceRef: string; agent: string }>>().notNull().default([]),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    decisions: jsonb('decisions').$type<string[]>().notNull().default([]),
    /** O que ficou pendente do humano. Não é falha: é a pergunta certa. */
    pendingQuestions: jsonb('pending_questions').$type<string[]>().notNull().default([]),
    agentOutputs: jsonb('agent_outputs').$type<Record<string, string>>().notNull().default({}),
    environment: text('environment').notNull().default('production'),
    ...timestampColumns,
  },
  (table) => ({
    execIdx: unique('execution_blackboards_execution_id_unique').on(table.executionId),
  }),
);

/**
 * A2A — mensagem TIPADA entre agentes, mediada pelo Orchestrator.
 *
 * Não é chat livre entre modelos: é um envelope com tipo, escopo e limite de
 * salto. Chat livre entre agentes gera loop, custo e verdade inventada em
 * consenso; envelope tipado é auditável e termina.
 */
export const agentMessages = pgTable(
  'agent_messages',
  {
    ...idColumn,
    executionId: text('execution_id').notNull(),
    fromAgent: text('from_agent').notNull(),
    toAgent: text('to_agent').notNull(),
    /** CONTEXT_REQUEST | CONTEXT_RESPONSE | HANDOFF | REVIEW_REQUEST | KNOWLEDGE_UPDATE | CONFLICT_FOUND */
    type: text('type').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    requestedContext: jsonb('requested_context').$type<string[]>().notNull().default([]),
    facts: jsonb('facts').$type<string[]>().notNull().default([]),
    sourceRefs: jsonb('source_refs').$type<string[]>().notNull().default([]),
    /** Quantos saltos já ocorreram nesta execução. O mediador corta no teto. */
    hop: integer('hop').notNull().default(1),
    status: text('status').notNull().default('sent'),
    environment: text('environment').notNull().default('production'),
    ...timestampColumns,
  },
  (table) => ({
    execIdx: index('agent_messages_execution_id_idx').on(table.executionId),
    tipoIdx: index('agent_messages_type_idx').on(table.type),
  }),
);
