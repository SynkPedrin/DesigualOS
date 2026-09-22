import {
  buildCorrectionDirective,
  decideQuality,
  selectBestCandidate,
  type Candidate,
  type QualityDecision,
} from './decision-engine';
import { critiqueImage, CriticUnavailableError, type CriticConfig, type CriticResult } from './visual-critic';
import type { QualityProfile } from './quality-profiles';

/**
 * Loop de qualidade (seções 13/14 do plano): gera -> critica -> decide ->
 * corrige -> regera, com teto de tentativas e seleção do melhor candidato.
 *
 * Fica separado do `index.ts` de propósito: o worker já é grande e mistura
 * cinco caminhos de job (image/carousel/video/upscale/html). Este módulo não
 * sabe nada de BullMQ, banco ou Storage - recebe funções e devolve o
 * resultado escolhido, o que também é o que torna ele testável sem GPU.
 */

export interface QaAttemptOutput {
  bytes: Buffer;
  /** O que o gerador registrou dessa tentativa (seed, workflow, steps...) - vai pro metadata. */
  generation: Record<string, unknown>;
}

export interface QaLoopParams<T extends QaAttemptOutput> {
  /** Briefing ORIGINAL do usuário - é contra ele que a aderência é medida, não contra o prompt compilado. */
  briefing: string;
  profile: QualityProfile;
  maxAttempts: number;
  identityCritical: boolean;
  productCritical: boolean;
  criticConfig: CriticConfig;
  /**
   * Gera uma tentativa. `correctionDirective` vem vazio na primeira e
   * carrega a instrução de correção nas seguintes. `attempt` é 1-based.
   */
  generate: (attempt: number, correctionDirective: string) => Promise<T>;
  /** Reporta estágio pro banco/WS. Os nomes são os de STUDIO_JOB_STATUSES. */
  onStage: (stage: 'generating' | 'evaluating' | 'refining', attempt: number) => Promise<void>;
  /**
   * Chamado ANTES de cada tentativa. Se devolver true, o loop para e
   * levanta `QaLoopCancelledError` - é o ponto de cancelamento "antes do
   * próximo ciclo" da seção 20.
   */
  isCancelled?: () => Promise<boolean>;
}

export class QaLoopCancelledError extends Error {
  constructor() {
    super('Job cancelado pelo usuário durante o loop de qualidade');
    this.name = 'QaLoopCancelledError';
  }
}

export interface QaLoopResult<T> {
  /** A peça escolhida pra entrega. */
  chosen: Candidate<T>;
  /** Todas as tentativas, na ordem - vira lineage no metadata (seção 14). */
  attempts: Candidate<T>[];
  /** Decisão que encerrou o loop. */
  finalDecision: QualityDecision;
  /**
   * Preenchido quando o crítico não pôde rodar. Nesse caso `attempts` traz
   * a geração sem score e o job segue - degradar pra pipeline antigo é o
   * comportamento correto, mentir um score não é.
   */
  criticUnavailableReason?: string;
}

/**
 * Score "ausente": usado só quando o crítico está indisponível, pra que a
 * estrutura de candidato continue válida sem inventar avaliação. Todos os
 * campos ficam em 0 e `confidence` em 0 - qualquer leitor consegue
 * distinguir isto de uma nota real.
 */
function unscored(): CriticResult {
  return {
    overall_score: 0, prompt_alignment: 0, composition: 0, lighting: 0, realism: 0,
    anatomy: 0, hands: 0, face: 0, text_integrity: 0, artifact_score: 0, commercial_quality: 0,
    problems: [], requires_regeneration: false, requires_local_edit: false, confidence: 0,
    provider: 'ollama', model: 'unavailable', latencyMs: 0,
  };
}

export async function runQualityLoop<T extends QaAttemptOutput>(params: QaLoopParams<T>): Promise<QaLoopResult<T>> {
  const attempts: Candidate<T>[] = [];
  let correctionDirective = '';
  let finalDecision: QualityDecision | null = null;

  for (let attempt = 1; attempt <= params.maxAttempts; attempt += 1) {
    if (await params.isCancelled?.()) throw new QaLoopCancelledError();

    await params.onStage(attempt === 1 ? 'generating' : 'refining', attempt);
    const output = await params.generate(attempt, correctionDirective);

    await params.onStage('evaluating', attempt);
    let critic: CriticResult;
    try {
      critic = await critiqueImage(
        {
          imageBytes: output.bytes,
          mediaType: 'image/png',
          briefing: params.briefing,
          identityCritical: params.identityCritical,
          productCritical: params.productCritical,
        },
        params.criticConfig,
      );
    } catch (error) {
      if (error instanceof CriticUnavailableError) {
        // Fallback da seção 23: sem crítico, entrega a geração que JÁ existe
        // (GPU já foi gasta) e diz por quê. Não falha o job, não finge nota.
        attempts.push({ attempt, critic: unscored(), payload: output });
        return {
          chosen: attempts[attempts.length - 1]!,
          attempts,
          finalDecision: {
            action: 'accept_best',
            reason: 'Crítico indisponível - entregue sem avaliação automática.',
            failedDimensions: [],
            targetRegions: [],
            thresholds: { overall: 0, artifact: 0, promptAlignment: 0, composition: 0, identity: 0, product: 0, region: 0 },
          },
          criticUnavailableReason: error.message,
        };
      }
      throw error;
    }

    attempts.push({ attempt, critic, payload: output });

    const decision = decideQuality({
      critic,
      profile: params.profile,
      attempt,
      maxAttempts: params.maxAttempts,
      identityCritical: params.identityCritical,
      productCritical: params.productCritical,
    });
    finalDecision = decision;

    if (decision.action === 'approve') {
      return { chosen: attempts[attempts.length - 1]!, attempts, finalDecision: decision };
    }
    if (decision.action === 'accept_best') break;

    const proximaDiretiva = buildCorrectionDirective(decision, critic);
    if (proximaDiretiva === null) {
      // Sem correção acionável, regerar é sorteio, não conserto - e sorteio
      // pode PIORAR (medido: tentativa 2 introduziu mãos deformadas numa
      // peça que não tinha mão). Para aqui e entrega o melhor candidato.
      finalDecision = {
        ...decision,
        action: 'accept_best',
        reason: `${decision.reason} Sem correção dirigida possível a partir do laudo - entregando o melhor candidato em vez de regerar às cegas.`,
      };
      break;
    }
    correctionDirective = proximaDiretiva;
  }

  // Saiu por teto de tentativas: o melhor candidato vence, não o último.
  return {
    chosen: selectBestCandidate(attempts),
    attempts,
    finalDecision: finalDecision ?? {
      action: 'accept_best',
      reason: 'Loop encerrado sem decisão registrada.',
      failedDimensions: [],
      targetRegions: [],
      thresholds: { overall: 0, artifact: 0, promptAlignment: 0, composition: 0, identity: 0, product: 0, region: 0 },
    },
  };
}
