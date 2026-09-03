import { boolean, integer, jsonb, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agentNameEnum } from './enums';
import { clients } from './clients';
import { users } from './identity';

export const studioProjects = pgTable('studio_projects', {
  ...idColumn,
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  ...timestampColumns,
});

export const studioAssets = pgTable('studio_assets', {
  ...idColumn,
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => studioProjects.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  filename: text('filename').notNull(),
  storageUrl: text('storage_url').notNull(),
  agent: agentNameEnum('agent').notNull().default('studio'),
  prompt: text('prompt'),
  model: text('model'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestampColumns,
});

/**
 * Um job assíncrono de geração de mídia na RTX 5090 (seção 7.3).
 * jobId é a chave de negócio legível (ex: STU-9282).
 */
export const studioJobs = pgTable('studio_jobs', {
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
  /** Se deve sobrepor texto (copy) nas imagens/slides gerados. */
  includeText: boolean('include_text').notNull().default(true),
  /** Legenda do post, gerada pelo passo de copy de marketing (packages/router/marketing-copy). */
  caption: text('caption'),
  /** Texto por slide/imagem, na mesma ordem em que os assets são gerados. */
  copySlides: jsonb('copy_slides').$type<{ headline: string; subtext?: string | undefined }[]>(),
  ...timestampColumns,
});

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
