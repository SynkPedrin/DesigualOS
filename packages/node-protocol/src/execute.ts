import { z } from 'zod';
import {
  AGENT_NAMES,
  STUDIO_BRAND_PLACEMENTS,
  STUDIO_REFERENCE_FIDELITY,
  STUDIO_REFERENCE_ROLES,
} from '@desigual-os/types';

/**
 * Brand kit do cliente no wire (snake_case): quem tem acesso ao banco é o
 * worker do Orchestrator, que lê client_brand_kits e manda aqui pro node
 * derivar o DNA criativo (packages/otto/src/creative/dna.ts) sem acessar
 * banco. Aditivo e opcional: nodes que não usam simplesmente ignoram.
 */
export const clientBrandKitSchema = z.object({
  colors: z.array(z.string()).default([]),
  fonts: z.array(z.string()).default([]),
  tone_of_voice: z.string().nullable().default(null),
  logo_url: z.string().nullable().default(null),
});

export type ClientBrandKit = z.infer<typeof clientBrandKitSchema>;

/**
 * Histórico real de feedback (aprovado/rejeitado/precisa iterar) do cliente,
 * lido de `memories` (kind `otto.feedback`, gravado em
 * apps/api/src/studio/routes.ts no POST .../feedback) pelo worker do
 * Orchestrator - mesmo padrão de client_brand_kit acima: quem tem acesso ao
 * banco monta isto e manda pro node, que nunca fala com o Postgres direto.
 * Achado real (2026-09-11): antes deste campo existir, `deriveCreativeDNA`
 * (packages/otto/src/creative/dna.ts) sempre recebia `feedbacks: []` - o DNA
 * criativo do cliente (approvedPatterns/rejectedPatterns/confidence) nunca
 * saía de zero, mesmo depois de dezenas de feedbacks reais registrados.
 */
export const clientFeedbackEntrySchema = z.object({
  verdict: z.enum(['approved', 'rejected', 'needs_iteration']),
  reason: z.string().default(''),
  context: z.string().default(''),
});

export type ClientFeedbackEntry = z.infer<typeof clientFeedbackEntrySchema>;

export const executeAttachmentSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  role: z.enum(STUDIO_REFERENCE_ROLES).optional(),
  fidelity: z.enum(STUDIO_REFERENCE_FIDELITY).optional(),
  instruction: z.string().min(1).optional(),
  placement: z.enum(STUDIO_BRAND_PLACEMENTS).optional(),
});

export type ExecuteAttachment = z.infer<typeof executeAttachmentSchema>;

/**
 * POST /execute (seção 7.1). message é o prompt já resolvido pelo Context
 * Engine (Fase 11); context_refs são recortes que o Node deve buscar
 * localmente sob demanda (ex: Obsidian), nunca um dump inteiro.
 */
export const executeRequestSchema = z.object({
  execution_id: z.string().min(1),
  message: z.string().min(1),
  context_refs: z.array(z.string()).default([]),
  client_brand_kit: clientBrandKitSchema.optional(),
  /** Ver clientFeedbackEntrySchema acima. Mais recente primeiro; o node decide quanto usar. */
  client_feedback_history: z.array(clientFeedbackEntrySchema).default([]),
  /** Arquivos anexados no turno. Otto os transforma em referências do Studio. */
  attachments: z.array(executeAttachmentSchema).max(10).default([]),
});

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export const executeResultStatusSchema = z.enum(['completed', 'failed', 'timeout']);

export const executeResponseSchema = z.object({
  execution_id: z.string(),
  agent: z.enum(AGENT_NAMES),
  status: executeResultStatusSchema,
  answer: z.string().nullable(),
  sources: z.array(z.string()).default([]),
  tool_calls: z.array(z.unknown()).default([]),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
  }),
  error: z.string().nullable().optional(),
  /**
   * Payload estruturado opcional, além do answer textual. Adicionado pro
   * Otto: o otto-node devolve aqui o creative_plan e a production_spec
   * (packages/otto) que o worker usa pra alimentar a fila studio-jobs.
   * Opcional e record genérico pra não quebrar os nodes que não produzem
   * nada além de texto (desigual-node segue sem enviar).
   */
  metadata: z.record(z.unknown()).optional(),
});

export type ExecuteResponse = z.infer<typeof executeResponseSchema>;
