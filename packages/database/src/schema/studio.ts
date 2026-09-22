import { boolean, index, integer, jsonb, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agentNameEnum } from './enums';
import { clients } from './clients';
import { users } from './identity';
import type { CanvaPage } from '@desigual-os/types';

export const studioProjects = pgTable('studio_projects', {
  ...idColumn,
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  ...timestampColumns,
});

export const studioAssets = pgTable(
  'studio_assets',
  {
    ...idColumn,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => studioProjects.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    filename: text('filename').notNull(),
    storageUrl: text('storage_url').notNull(),
    /** Thumbnail 480px webp gerada em background pelo worker (fila
     * studio-thumbnails). A galeria usa ela em vez do original de 2-17MB;
     * o original segue pro lightbox/download. Null até o worker processar. */
    thumbUrl: text('thumb_url'),
    agent: agentNameEnum('agent').notNull().default('studio'),
    prompt: text('prompt'),
    model: text('model'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('studio_assets_client_id_idx').on(table.clientId),
  }),
);

/**
 * Um job assíncrono de geração de mídia na RTX 5090 (seção 7.3).
 * jobId é a chave de negócio legível (ex: STU-9282).
 */
export const studioJobs = pgTable(
  'studio_jobs',
  {
  ...idColumn,
  jobId: text('job_id').notNull().unique(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  // Quem pediu o job (seção "Studio continua gerando com o usuário fora",
  // 2026-09-02): sem isso não dá pra restaurar "meus jobs em andamento" ao
  // reabrir o Studio, nem notificar a pessoa certa quando terminar.
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => studioProjects.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  status: text('status').notNull().default('queued'),
  prompt: text('prompt'),
  resolution: text('resolution'),
  progress: integer('progress').notNull().default(0),
  /**
   * Por que falhou, em texto que o colaborador entenda. Sem isso um job
   * falhado só sumia da tela sem explicação nenhuma (relatado de verdade:
   * "o job começou e depois simplesmente sumiu"). Null enquanto não falhou.
   */
  error: text('error'),
  /**
   * Arquivos de referência anexados pelo usuário (imagem/PDF) pra guiar a
   * geração. Guarda o caminho no Storage e o tipo, não o binário.
   */
  attachments: jsonb('attachments')
    .$type<{ filename: string; url: string; contentType: string }[]>()
    .notNull()
    .default([]),
  assetId: uuid('asset_id').references(() => studioAssets.id, { onDelete: 'set null' }),
  gpuTimeMs: integer('gpu_time_ms'),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
  actualCost: numeric('actual_cost', { precision: 12, scale: 6 }),
  /** Só carousel: quantas imagens gerar (cada uma um asset próprio, ligados por metadata.job_id). */
  numSlides: integer('num_slides'),
  /** Só video/reels: escolha do usuário, guardada mesmo enquanto a geração real não está ligada. */
  durationSeconds: integer('duration_seconds'),
  qualityPreset: text('quality_preset'),
  /** Se deve sobrepor texto (copy) nas imagens/slides gerados. Default false
   * (09/09/2026): generateStudioCopy tem persona fixa do Cinema Impossível
   * (abre com verso de música) e vazava pra qualquer cliente sem relação com
   * música quando isso vinha true por padrão - ver apps/api/src/studio/routes.ts. */
  includeText: boolean('include_text').notNull().default(false),
  /** Legenda do post, gerada pelo passo de copy de marketing (packages/router/marketing-copy). */
  caption: text('caption'),
  /** Texto por slide/imagem, na mesma ordem em que os assets são gerados. */
  copySlides: jsonb('copy_slides').$type<{ headline: string; subtext?: string | undefined }[]>(),
  /** Estilo visual escolhido na tela do Studio; o worker traduz em modificador de prompt. */
  style: text('style').notNull().default('padrao'),
  /** Só image: quantas variações gerar do mesmo prompt (1, 2, 4, 6 ou 8). */
  variations: integer('variations').notNull().default(1),
  /** Opções extras do produtor + snapshot do brand kit do cliente (metadata.brand_kit). */
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('studio_jobs_client_id_idx').on(table.clientId),
  }),
);

/**
 * Dados específicos injetados nos jobs de geração para reduzir prompt manual
 * (seção 7.3): referências visuais e dimensões, além do branding geral
 * já coberto por client_brand_kits em schema/clients.ts.
 */
export const studioBrandKits = pgTable('studio_brand_kits', {
  ...idColumn,
  clientId: uuid('client_id')
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: 'cascade' }),
  referenceImages: jsonb('reference_images').$type<string[]>().notNull().default([]),
  dimensions: jsonb('dimensions').$type<Record<string, string>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestampColumns,
});

/**
 * Documento do editor gráfico Studio > Canva (pedido do usuário, 2026-09-10).
 * Cada linha é UM design (posts, banners, carrossel etc.), com todas as
 * páginas e objetos preservados como estrutura editável em `pages` - nunca
 * achatado pra PNG. `pages` é a fonte de verdade; export/thumbnail são
 * derivados, não armazenados aqui.
 */
export const studioCanvasDocuments = pgTable(
  'studio_canvas_documents',
  {
    ...idColumn,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => studioProjects.id, { onDelete: 'set null' }),
    name: text('name').notNull().default('Sem título'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Renderizado sob demanda (thumbnail da página 1) no autosave; não é a fonte de verdade. */
    thumbnailUrl: text('thumbnail_url'),
    pages: jsonb('pages').$type<CanvaPage[]>().notNull().default([]),
    /**
     * Concorrência otimista (§53 da auditoria de prontidão, 18/09/2026).
     *
     * O editor autossalva o documento INTEIRO a cada 1,5s, e o workspace de um
     * cliente é compartilhado pela equipe toda (ver lib/access.ts). Sem esta
     * coluna, dois colaboradores com o mesmo design aberto se sobrescreviam em
     * silêncio: o último PATCH a chegar apagava tudo que o outro fez, sem erro,
     * sem aviso e sem forma de recuperar - `pages` é o documento inteiro, não
     * um diff.
     *
     * Cada gravação bem-sucedida incrementa. Quem envia uma versão diferente da
     * que está no banco recebe 409 com o estado atual, em vez de destruir o
     * trabalho de outra pessoa.
     */
    version: integer('version').notNull().default(1),
    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('studio_canvas_documents_client_id_idx').on(table.clientId),
  }),
);
