import { createHash } from 'node:crypto';

/**
 * Fingerprint de geração (seção 25 do plano de evolução). Duas coisas MUITO
 * diferentes usam a palavra "retry" e não podem ser tratadas igual:
 *
 *   infrastructure retry - o worker BullMQ perdeu o job no meio (crash,
 *     restart do processo, connection reset) e o Redis reenfileira o MESMO
 *     jobId. Isso NÃO deve gerar de novo se já tiver terminado.
 *
 *   creative reroll - a pessoa clicou "Criar variação" de propósito,
 *     querendo uma imagem DIFERENTE do mesmo prompt. Isso DEVE sortear seed
 *     nova e gerar de novo - fingerprint diferente por design (seed muda).
 *
 * O fingerprint cobre exatamente os campos que definem "é a mesma geração
 * de novo": se qualquer um mudar, é trabalho novo, não duplicata.
 */
export interface GenerationFingerprintInput {
  clientId: string;
  workflowId: string;
  workflowVersion: string;
  modelVersion: string;
  seed: number;
  qualityProfile: string;
  referenceAssetIds?: string[];
  /** Prompt final + demais parâmetros que afetam o resultado (denoise, resolução, style) - qualquer coisa que mudaria o pixel de saída. */
  generationParameters: Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function computeGenerationFingerprint(input: GenerationFingerprintInput): string {
  const canonical = stableStringify({
    clientId: input.clientId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    modelVersion: input.modelVersion,
    seed: input.seed,
    qualityProfile: input.qualityProfile,
    referenceAssetIds: [...(input.referenceAssetIds ?? [])].sort(),
    generationParameters: input.generationParameters,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
