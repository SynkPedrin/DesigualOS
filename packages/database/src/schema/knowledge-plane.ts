import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';

/**
 * knowledge-plane.ts — as ENTIDADES da operação que antes só existiam como
 * texto solto: campanha e pessoa.
 *
 * Os dois bugs relatados pela operação (16/09/2026) são a mesma classe:
 *
 *  - "Jardim Europa 5" resolveu para o cliente "Jardim do Lago" e o Otto
 *    escreveu a legenda do cliente ERRADO. A campanha existia (253 tasks em
 *    Cosentino, escrita "Europa V" no nome e "Jardim Europa V" na descrição),
 *    mas campanha não era uma entidade: só havia cliente. Sem nada para casar,
 *    o texto caiu no matcher de cliente, que casou pela palavra "jardim".
 *
 *  - "Esther é responsável pela conta D. Carvalho" foi afirmado sem que Esther
 *    exista em NENHUMA fonte (não é membro do ClickUp, não aparece em 7.408
 *    tasks, não está no banco nem nos vaults). Pessoa também não era entidade,
 *    então não havia onde checar nem o que negar.
 *
 * Estas tabelas são DERIVADAS da fonte, nunca digitadas à mão: a reconciliação
 * reconstrói tudo a partir do ClickUp. Por isso cada linha carrega proveniência
 * e `lastSourceUpdateAt` — o que não vem da fonte não entra.
 */

/**
 * Campanha: agrupamento nomeado de tasks dentro de um cliente. Sai da convenção
 * real da operação (`Cliente_Campanha_Peça`) e das tasks-pai; nunca de palpite.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    ...idColumn,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Como a fonte escreve, preservado para exibição: "Europa V". */
    canonicalName: text('canonical_name').notNull(),
    /** Forma dobrada para busca exata (sem acento/caixa/pontuação). */
    normalizedName: text('normalized_name').notNull(),
    /**
     * Outras formas pelas quais a operação chama a mesma campanha, incluindo as
     * variantes de numeral. É o que faz "Jardim Europa 5" (como a pessoa fala)
     * encontrar "Europa V" (como a fonte escreve).
     */
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    /** 'active' enquanto houver task aberta; 'historical' quando todas fecharam. */
    status: text('status').notNull().default('active'),
    sourceType: text('source_type').notNull().default('clickup'),
    /** Lista do ClickUp de onde a campanha foi derivada. */
    sourceListId: text('source_list_id'),
    /** Ids das tasks que sustentam a campanha (evidência, não decoração). */
    taskRefs: jsonb('task_refs').$type<string[]>().notNull().default([]),
    /**
     * As tasks mais recentes da campanha, com nome e status. É O CONTEXTO que o
     * Otto precisa para escrever: sem isto a campanha resolveria e mesmo assim
     * ele não saberia o que já existe nela, que foi metade do problema — ele
     * caiu no brand boilerplate por não ter nada específico em mãos.
     */
    recentTasks: jsonb('recent_tasks')
      .$type<Array<{ id: string; name: string; status: string | null; closed: boolean; updatedAt: string | null }>>()
      .notNull()
      .default([]),
    taskCount: integer('task_count').notNull().default(0),
    openTaskCount: integer('open_task_count').notNull().default(0),
    /** Task mais recente da campanha: é o que decide frescor. */
    lastSourceUpdateAt: timestamp('last_source_update_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('campaigns_client_id_idx').on(table.clientId),
    normalizedIdx: index('campaigns_normalized_name_idx').on(table.normalizedName),
    // Idempotência da reconciliação: reimportar ATUALIZA a campanha.
    porCliente: unique('campaigns_client_normalized_unique').on(table.clientId, table.normalizedName),
  }),
);

/**
 * Pessoa da operação. Vem do diretório do ClickUp e de quem aparece como
 * responsável/autor em task e comentário. Quem não está em fonte nenhuma NÃO
 * ganha linha aqui — é exatamente o caso da Esther, e a ausência é a resposta.
 */
export const people = pgTable(
  'people',
  {
    ...idColumn,
    canonicalName: text('canonical_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    email: text('email'),
    /** Id no ClickUp quando a pessoa é membro do workspace. */
    clickupUserId: text('clickup_user_id'),
    /**
     * 'agency_member' quando está no diretório do workspace; 'external' quando
     * só aparece citada. NUNCA inferido de volume de trabalho.
     */
    employmentType: text('employment_type').notNull().default('unknown'),
    /** 'active' | 'inactive' — só quando a fonte permite determinar. */
    activeStatus: text('active_status').notNull().default('unknown'),
    sourceRefs: jsonb('source_refs').$type<string[]>().notNull().default([]),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    normalizedIdx: index('people_normalized_name_idx').on(table.normalizedName),
    canonico: unique('people_normalized_name_unique').on(table.normalizedName),
  }),
);

/**
 * Relação pessoa <-> cliente, SEMPRE com tipo e evidência.
 *
 * O bug da Esther não foi achar a pessoa errada: foi promover uma relação fraca
 * a "responsável pela conta". Aqui o tipo é explícito e a evidência é
 * obrigatória, então "aparece numa task deste cliente" (TASK_ASSIGNEE) nunca
 * pode ser lido como "responde pela conta" (ACCOUNT_MANAGER) — são linhas
 * diferentes, e a segunda só existe se a fonte disser.
 */
export const personClientRelations = pgTable(
  'person_client_relations',
  {
    ...idColumn,
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /**
     * TASK_ASSIGNEE | TASK_COMMENTER | MENTIONED_IN_DOCUMENT |
     * ACCOUNT_MANAGER | CLIENT_OWNER | CREATIVE_CONTRIBUTOR |
     * WORKS_FOR_AGENCY | FREELANCER_FOR_AGENCY
     */
    relationType: text('relation_type').notNull(),
    /** 'current' | 'historical' — derivado de atividade recente na fonte. */
    temporalStatus: text('temporal_status').notNull().default('current'),
    /** Tasks/comentários que sustentam a relação. Sem isto, a relação não vale. */
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    evidenceCount: integer('evidence_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    personIdx: index('pcr_person_id_idx').on(table.personId),
    clientIdx: index('pcr_client_id_idx').on(table.clientId),
    unico: unique('pcr_person_client_type_unique').on(table.personId, table.clientId, table.relationType),
  }),
);

/**
 * Estado de sincronização por cliente e por fonte. É o que permite responder
 * "esse cliente está com conhecimento atualizado?" em vez de apenas "a busca
 * devolveu alguma coisa" — a pergunta que a operação realmente faz.
 */
export const clientKnowledgeSync = pgTable(
  'client_knowledge_sync',
  {
    ...idColumn,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** 'clickup' | 'vault' | 'brain' | 'campaigns' | 'people' | 'comments' */
    source: text('source').notNull(),
    /** 'ok' | 'stale' | 'empty' | 'error' */
    status: text('status').notNull().default('ok'),
    documentCount: integer('document_count').notNull().default(0),
    /** Momento mais recente que a FONTE mudou (não o momento do sync). */
    lastSourceUpdateAt: timestamp('last_source_update_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    detail: text('detail'),
    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('cks_client_id_idx').on(table.clientId),
    unico: unique('cks_client_source_unique').on(table.clientId, table.source),
  }),
);
