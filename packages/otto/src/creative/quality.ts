import type { Logger } from '@desigual-os/logging';
import type { OttoLLMProvider } from '../llm/ollama-provider.js';
import { qualityEvaluationSchema } from './schemas.js';
import type { CreativePlan, QualityEvaluation } from './schemas.js';

/**
 * QC estruturado do Otto: avalia um asset gerado contra os quality_criteria
 * do plano que o originou. O QC nunca avalia no vazio ("a imagem é boa?") -
 * avalia aderência à direção ("a imagem entrega o que o plano decidiu?").
 */

export interface QualityDeps {
  llm: OttoLLMProvider;
  logger?: Logger;
}

export interface CreativeAssetUnderReview {
  /** URL ou path do asset gerado, pra rastreabilidade no resultado. */
  uri?: string;
  /** Descrição textual do que foi gerado (o LLM local não vê a imagem). */
  description: string;
  /** Prompt efetivamente usado na geração, pra checar aderência. */
  promptUsed?: string;
}

const CORE_CRITERIA = [
  'coerência de marca',
  'clareza da mensagem',
  'composição',
  'hierarquia visual',
  'legibilidade',
  'originalidade',
  'storytelling',
  'aderência ao objetivo',
  'adequação ao público',
  'consistência com o plano',
  'qualidade técnica',
];

export async function evaluateCreative(
  deps: QualityDeps,
  asset: CreativeAssetUnderReview,
  plan: CreativePlan,
): Promise<QualityEvaluation> {
  const planCriteria = plan.quality_criteria
    .map((criterion) => `- ${criterion.criterion} (peso ${criterion.weight}): ${criterion.description}`)
    .join('\n');

  const system = `Você é OTTO, diretor criativo da agência Desigual, agora em papel de controle de qualidade. Avalie o asset gerado contra os critérios do plano criativo que o originou.

Critérios centrais da agência (sempre avaliados):
${CORE_CRITERIA.map((criterion) => `- ${criterion}`).join('\n')}

Critérios específicos deste plano:
${planCriteria}

Regras:
- Seja honesto: aprovar asset medíocre custa mais caro que iterar.
- "needs_iteration" é o veredito certo quando o asset está no caminho mas falha em critério de peso alto.
- Dê nota de 0 a 10 por critério em "scores" (chave = nome do critério).
- Liste em "issues" só problemas concretos e acionáveis.
- Responda SOMENTE com o JSON: {"verdict": "approved"|"rejected"|"needs_iteration", "scores": {criterio: nota}, "issues": [{"criterion": string, "severity": "low"|"medium"|"high", "description": string}], "reasoning": string}`;

  const user = [
    `Plano criativo de origem:\n${JSON.stringify(plan, null, 2)}`,
    asset.promptUsed ? `Prompt usado na geração:\n${asset.promptUsed}` : null,
    `Descrição do asset gerado:\n${asset.description}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  deps.logger?.info({ assetUri: asset.uri }, 'otto: avaliando asset');
  // Temperatura baixa: QC é julgamento, não criação.
  return deps.llm.chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    qualityEvaluationSchema,
    { temperature: 0.2 },
  );
}
