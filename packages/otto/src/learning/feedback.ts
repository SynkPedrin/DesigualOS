import type {
  OttoEvidence,
  OttoLearning,
  OttoLearningKind,
  OttoLearningStage,
} from './pipeline.js';
import { createLearning, promoteLearning, recordEvidence } from './pipeline.js';

/**
 * Mapeamento de feedback humano do Studio -> funil de confiança
 * (pipeline.ts). Puro, sem DB: a persistência (metadata.otto_learning em
 * `memories`) fica em apps/api/src/studio/otto-learnings.ts.
 *
 * Regras de mapeamento:
 *  - approved        -> otto.approval_reason
 *  - rejected        -> otto.rejection_reason
 *  - needs_iteration -> otto.rejection_reason com peso menor (rejeição
 *                       parcial: "ainda não está bom")
 *  - autor master    -> origem 'director' (o diretor criativo assinando);
 *                       demais colaboradores -> 'human_feedback'. Sem uma
 *                       dessas origens o funil NUNCA passa de experimental.
 *
 * A evidência é sempre A FAVOR do aprendizado do próprio kind: uma rejeição
 * nova confirma o padrão "cliente rejeita X" (otto.rejection_reason), não o
 * contradiz — contradizer exigiria casamento semântico entre motivos, que
 * este módulo deliberadamente não tenta.
 */

export type OttoFeedbackVerdict = 'approved' | 'rejected' | 'needs_iteration';

export interface OttoFeedbackInput {
  verdict: OttoFeedbackVerdict;
  reason?: string | undefined;
  /** true quando o autor do feedback é master (diretor criativo da agência). */
  isDirector: boolean;
}

export interface OttoLearningPersistedState {
  stage: OttoLearningStage;
  confidence: number;
  evidences: OttoEvidence[];
}

export interface OttoFeedbackTransition {
  kind: OttoLearningKind;
  subject: string;
  content: string;
  learning: OttoLearning;
  promoted: boolean;
  promotionBlockers: string[];
}

export function learningKindForVerdict(verdict: OttoFeedbackVerdict): OttoLearningKind {
  return verdict === 'approved' ? 'otto.approval_reason' : 'otto.rejection_reason';
}

/** Slug estável do motivo: a mesma razão escrita com acento/caixa/pontuação
 * diferente cai no MESMO subject e acumula evidência em vez de duplicar. */
export function feedbackSubject(kind: OttoLearningKind, reason: string | undefined): string {
  const slug = (reason ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${kind}:${slug.length > 0 ? slug : 'sem-motivo'}`;
}

/**
 * Dado o estado persistido (ou null = primeiro feedback sobre esse motivo)
 * e o feedback novo, devolve o aprendizado com a evidência registrada e a
 * promoção de estágio tentada. Nunca lança: "não promoveu" é estado normal
 * do funil, não erro.
 */
export function applyFeedbackToLearning(
  persisted: { content: string; state: OttoLearningPersistedState } | null,
  input: OttoFeedbackInput,
  clientId: string,
): OttoFeedbackTransition {
  const kind = learningKindForVerdict(input.verdict);
  const reason = input.reason?.trim();

  const base: OttoLearning = persisted
    ? {
        kind,
        content: persisted.content,
        clientId,
        stage: persisted.state.stage,
        confidence: persisted.state.confidence,
        evidences: persisted.state.evidences,
      }
    : createLearning({
        kind,
        // O consumidor persiste via memory-engine, que descarta conteúdo com
        // menos de 25 chars como ruído — o texto nasce acima disso sempre.
        content: reason
          ? `Feedback humano recorrente: ${reason}`
          : 'Feedback humano sem motivo detalhado (ver histórico otto.feedback).',
        clientId,
      });

  const withEvidence = recordEvidence(base, {
    origin: input.isDirector ? 'director' : 'human_feedback',
    positive: true,
    ...(input.verdict === 'needs_iteration' ? { weight: 0.7 } : {}),
  });

  const promotion = promoteLearning(withEvidence);
  return {
    kind,
    subject: feedbackSubject(kind, input.reason),
    content: base.content,
    learning: promotion.learning,
    promoted: promotion.promoted,
    promotionBlockers: promotion.blockers,
  };
}
