import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';
import { conversations, projects } from './conversation';
import { users } from './identity';

/**
 * OTTO MOTION ENGINE — sessão persistente de um motion (§18).
 *
 * Existe separada de `studio_jobs` de propósito: o Studio é geração de mídia
 * na GPU a partir de prompt, esta tabela é um PROJETO de código que sobrevive
 * a várias rodadas de conversa. Misturar os dois na mesma tabela obrigaria
 * `studio_jobs` a carregar colunas (workspace, render_version, model) que não
 * dizem nada pra 100% das linhas que já existem lá.
 *
 * `workspace_path` é o caminho no disco do worker, e é a razão de a sessão ser
 * durável: "deixa o preço entrar mais forte" três dias depois precisa achar o
 * projeto de volta pra aplicar patch em vez de recriar tudo (§43).
 */
export const motionSessions = pgTable(
  'motion_sessions',
  {
    ...idColumn,
    /**
     * Nullable desde o modo AD_HOC (adendo "Otto Motion via chat direto"):
     * um motion pode nascer só de prompt + anexos, sem cliente selecionado,
     * quando o próprio pedido já traz marca/produto/cenário via anexo. Sem
     * cliente, não há brand kit nem acervo — o pipeline usa só o que a
     * pessoa anexou naquele turno (ver client-context/resolver.ts,
     * ramo ad-hoc). `onDelete: cascade` só se aplica quando preenchido.
     */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),

    workspacePath: text('workspace_path').notNull(),
    status: text('status').notNull().default('queued'),
    /** Detalhe do estágio pra UI (§27/§39). Texto de pessoa, não de log. */
    stageDetail: text('stage_detail'),

    prompt: text('prompt').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    fps: integer('fps').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    format: text('format').notNull(),

    /**
     * Modelo que de fato produziu o código. Gravado por auditoria: §5 proíbe
     * fallback silencioso, e coluna preenchida é como se PROVA depois que não
     * houve troca — a promessa sozinha não prova nada.
     */
    model: text('model').notNull(),

    /** §41 — versionamento mínimo. Cada render final incrementa. */
    renderVersion: integer('render_version').notNull().default(0),

    error: text('error'),
    errorCode: text('error_code'),

    /** Contexto do cliente resolvido, referências do usuário, seleção de assets. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('motion_sessions_client_id_idx').on(table.clientId),
    conversationIdx: index('motion_sessions_conversation_id_idx').on(table.conversationId),
  }),
);

/**
 * §41 — cada render é uma linha, e a anterior NUNCA é destruída.
 *
 * Preview e final convivem: preview é o que o QA olha e o que a pessoa vê
 * primeiro (§23), final é o entregável. Guardar os dois permite mostrar algo
 * no chat enquanto o final ainda renderiza, e permite voltar pra V1 depois de
 * uma V2 que ficou pior.
 */
export const motionRenders = pgTable(
  'motion_renders',
  {
    ...idColumn,
    motionSessionId: uuid('motion_session_id')
      .notNull()
      .references(() => motionSessions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    quality: text('quality').notNull(),
    storageUrl: text('storage_url'),
    durationSeconds: integer('duration_seconds'),
    width: integer('width'),
    height: integer('height'),
    fps: integer('fps'),
    sizeBytes: integer('size_bytes'),
    renderTimeMs: integer('render_time_ms'),
    /** §44 — checklist interno (technical/visual/brand/legibility/composition). */
    qualityScore: jsonb('quality_score').$type<Record<string, number>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    sessionIdx: index('motion_renders_session_id_idx').on(table.motionSessionId),
  }),
);
