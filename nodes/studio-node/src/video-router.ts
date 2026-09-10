/**
 * Staging de vídeo (seções 15-17 do plano de evolução): Keyframe -> H3
 * Draft -> Motion QA -> H3 Master. Diferente do Workflow Router de imagem,
 * aqui não existe "escolher 1 workflow" - é uma SEQUÊNCIA de estágios, e
 * cada estágio só libera o próximo mediante aprovação.
 *
 * Motion QA real (análise de flicker/morphing/coerência temporal sobre os
 * frames do vídeo) NÃO está implementado nesta sessão - exigiria decodificar
 * frames do .mp4 e rodar QA visual sobre uma amostra deles, escopo maior que
 * o Visual QA de imagem única (visual-qa.ts). Por isso o gate default aqui é
 * conservador: sem uma função de aprovação explícita, NUNCA promove sozinho
 * pro Master - é preciso aprovação humana ou uma futura implementação real
 * de Motion QA, nunca um "true" implícito.
 */

export type H3Stage = 'keyframe' | 'keyframe_qa' | 'draft' | 'motion_qa' | 'master';

export interface H3StagingDecision {
  stage: H3Stage;
  reason: string;
}

export interface H3StagingContext {
  /** Já existe um keyframe (upload do usuário ou já gerado nesta run)? */
  hasKeyframe: boolean;
  /** Visual QA (visual-qa.ts) já rodou sobre o keyframe e aprovou? undefined = QA não rodou. */
  keyframeApproved?: boolean | undefined;
  /** Já existe um H3 Draft gerado nesta run? */
  hasDraft: boolean;
  /** Alguém (humano, ou uma futura Motion QA real) já aprovou o Draft explicitamente pro Master? undefined = ainda não decidido. */
  draftApprovedForMaster?: boolean | undefined;
}

/**
 * Decide o PRÓXIMO estágio, não executa nada. Seção 17: "não enviar ao H3
 * usando keyframes visualmente ruins" - por isso keyframe sem QA aprovado
 * trava aqui, não passa pro Draft por default.
 */
export function nextH3Stage(ctx: H3StagingContext): H3StagingDecision {
  if (!ctx.hasKeyframe) {
    return { stage: 'keyframe', reason: 'sem keyframe ainda - gera via Flux ou usa a referência anexada' };
  }
  if (ctx.keyframeApproved === undefined) {
    return { stage: 'keyframe_qa', reason: 'keyframe existe mas ainda não foi avaliado' };
  }
  if (ctx.keyframeApproved === false) {
    return { stage: 'keyframe', reason: 'Visual QA reprovou o keyframe - regenerar antes de animar' };
  }
  if (!ctx.hasDraft) {
    return { stage: 'draft', reason: 'keyframe aprovado - explora movimento/seed/câmera no Draft antes do Master (seção 16)' };
  }
  if (ctx.draftApprovedForMaster !== true) {
    return { stage: 'motion_qa', reason: 'Draft existe mas ainda não foi aprovado pro Master - NUNCA promove sozinho (Motion QA real não implementada nesta sessão)' };
  }
  return { stage: 'master', reason: 'Draft aprovado - gera a versão final (8-14min de GPU, só roda uma vez por aprovação)' };
}
