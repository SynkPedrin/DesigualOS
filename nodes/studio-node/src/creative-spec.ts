import type { CreativeSpec } from '@desigual-os/types';
import type { StudioJobData } from '@desigual-os/orchestrator';
import type { GrainMode } from './finish';

/**
 * O Otto já produz CreativeSpec completo. Esta função continua sendo a
 * barreira de compatibilidade para jobs criados diretamente pela API, jobs
 * antigos e outros produtores: monta o melhor spec possível a partir dos
 * campos que StudioJobData já carrega.
 *
 * Prioridade: se `job.metadata.creative_spec` já vier preenchido (de um
 * produtor (Otto ou outro), ele GANHA - esta função só herda campos
 * que não vieram nele.
 */
export function deriveCreativeSpec(job: Pick<StudioJobData, 'type' | 'prompt' | 'style' | 'qualityPreset' | 'referenceImages' | 'metadata'>): CreativeSpec {
  const explicit = (job.metadata?.creative_spec ?? {}) as CreativeSpec;
  const hasReference = Boolean(job.referenceImages && job.referenceImages.length > 0);

  const contentType: CreativeSpec['contentType'] =
    explicit.contentType ?? (job.type === 'reels' ? 'reel' : job.type === 'image' || job.type === 'carousel' || job.type === 'video' ? job.type : undefined);

  const operation: CreativeSpec['operation'] =
    explicit.operation ?? (job.type === 'video' || job.type === 'reels' ? 'animate' : hasReference ? 'variation' : 'generate');

  const qualityProfile: CreativeSpec['qualityProfile'] =
    explicit.qualityProfile ?? (job.qualityPreset === 'draft' ? 'draft' : job.qualityPreset === 'high' ? 'master' : 'standard');

  const transformationStrength: CreativeSpec['transformationStrength'] =
    explicit.transformationStrength ??
    (typeof job.metadata?.transformation_strength === 'string' && ['low', 'medium', 'high'].includes(job.metadata.transformation_strength)
      ? (job.metadata.transformation_strength as 'low' | 'medium' | 'high')
      : undefined);

  const grain = explicit.finish?.grain ?? (typeof job.metadata?.grain === 'string' ? (job.metadata.grain as GrainMode) : undefined);
  const objective = explicit.objective ?? job.prompt ?? undefined;
  const artDirection = explicit.artDirection ?? (job.style && job.style !== 'padrao' ? { style: [job.style] } : undefined);
  const finish = explicit.finish ?? (grain ? { grain } : undefined);

  const spec: CreativeSpec = { ...explicit, operation, qualityProfile };
  if (contentType !== undefined) spec.contentType = contentType;
  if (objective !== undefined) spec.objective = objective;
  if (artDirection !== undefined) spec.artDirection = artDirection;
  if (transformationStrength !== undefined) spec.transformationStrength = transformationStrength;
  if (finish !== undefined) spec.finish = finish;
  return spec;
}

/** Palavras que indicam edição localizada com preservação forte. */
const EDIT_INTENT_PATTERNS = [
  /\btroque? (apenas |só )?(a |o )?(cor|fundo|iluminação|luz)\b/i,
  /\bmude (apenas |só )?(a |o )?(cor|fundo|iluminação|luz)\b/i,
  /\bmantenha (exatamente )?/i,
  /\bpreserve\b/i,
  /\baltere (apenas|só)\b/i,
];

export function detectEditIntent(prompt: string | null | undefined): boolean {
  if (!prompt) return false;
  return EDIT_INTENT_PATTERNS.some((pattern) => pattern.test(prompt));
}
