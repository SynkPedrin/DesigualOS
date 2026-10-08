/** Brief + BriefVersion (P1-E, 06/10/2026) — especificação do que produzir,
 *  nascida de uma Demand. Nunca sobrescrita silenciosamente: toda mudança
 *  relevante é uma VERSÃO nova. */
export const BRIEF_STATUSES = ['draft', 'in_review', 'approved', 'sent_to_production'] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export const BRIEF_VERSION_SOURCES = ['ai_draft', 'human_edit'] as const;
export type BriefVersionSource = (typeof BRIEF_VERSION_SOURCES)[number];

/** Campos estruturados do conteúdo — todos opcionais: campo ausente é
 *  `[CONFIRMAR: ...]`/null, nunca inventado (mesmo critério do Otto skill). */
export interface BriefContent {
  objective?: string | undefined;
  deliverable?: string | undefined;
  channel?: string | undefined;
  format?: string | undefined;
  deadline?: string | undefined;
  references?: string[] | undefined;
  direction?: string | undefined;
  restrictions?: string | undefined;
  assets?: string[] | undefined;
  notes?: string | undefined;
}
