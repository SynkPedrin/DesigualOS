import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Visual QA (seção 20 do plano de evolução). Usa visão real do Claude
 * (@anthropic-ai/sdk, mesmo pacote que packages/router/src/classifier.ts já
 * usa pro Router de texto) sobre a imagem gerada - NÃO é um score
 * inventado. Se ANTHROPIC_API_KEY não estiver configurada no ambiente do
 * studio-node, falha ALTO (lança `VisualQAUnavailableError`), não devolve
 * um resultado fake nem finge aprovação silenciosa - quem chamar decide
 * explicitamente o que fazer com a indisponibilidade (skip documentado ou
 * falha do job), a decisão não fica escondida aqui dentro.
 *
 * NÃO TESTADO CONTRA A API REAL nesta sessão: não havia ANTHROPIC_API_KEY
 * disponível no ambiente onde isto foi escrito (mesma ressalva que
 * packages/router/src/classifier.ts já tinha antes desta mudança).
 * Implementação segue a API documentada do SDK oficial (vision via content
 * block `image` com `source.type: 'base64'`) - validar contra uma chave
 * real e uma imagem real do Studio antes de confiar em produção.
 */

export class VisualQAUnavailableError extends Error {
  constructor(reason: string) {
    super(`Visual QA indisponível: ${reason}`);
    this.name = 'VisualQAUnavailableError';
  }
}

const visualQAResultSchema = z.object({
  score: z.number().min(0).max(1),
  briefingAdherence: z.number().min(0).max(1),
  composition: z.number().min(0).max(1),
  subjectIntegrity: z.number().min(0).max(1),
  productIntegrity: z.number().min(0).max(1).nullable().optional(),
  identityIntegrity: z.number().min(0).max(1).nullable().optional(),
  artifactScore: z.number().min(0).max(1),
  lighting: z.number().min(0).max(1),
  brandConsistency: z.number().min(0).max(1).nullable().optional(),
  recommendation: z.enum(['approve', 'refine', 'regenerate']),
  issues: z.array(z.string()),
  /** Seção 12: aponta se falta microtextura real (pele/tecido/material) - é isso que decide MASTER finish, não resolução sozinha. */
  detailInsufficient: z.boolean(),
});

export type VisualQAResult = z.infer<typeof visualQAResultSchema>;

const SYSTEM_PROMPT = `Você é um QA visual para peças geradas por IA generativa (Flux) de uma agência de marketing.
Avalie a imagem anexada contra o briefing/prompt fornecido. Seja rigoroso e específico - "issues" deve
listar defeitos CONCRETOS e observáveis (não genéricos), ou ficar vazio se não houver nenhum.
"detailInsufficient" = true APENAS quando pele/tecido/material parecem lisos/plásticos demais (falta de
microtextura real), não pra qualquer imperfeição menor.
Responda SÓ com um JSON no formato:
{"score": 0-1, "briefingAdherence": 0-1, "composition": 0-1, "subjectIntegrity": 0-1,
 "productIntegrity": 0-1|null, "identityIntegrity": 0-1|null, "artifactScore": 0-1, "lighting": 0-1,
 "brandConsistency": 0-1|null, "recommendation": "approve"|"refine"|"regenerate", "issues": string[],
 "detailInsufficient": boolean}
"artifactScore" 1.0 = sem artefatos (mãos/rosto/texto quebrado), 0.0 = artefatos graves.
"recommendation": "regenerate" se erro estrutural/composição ruim/produto errado/rosto ruim/briefing não
atendido; "refine" se composição e identidade corretas mas falta detalhe/microtextura; "approve" se já
está bom o bastante pro profile pedido.`;

export interface VisualQAInput {
  imageBytes: Buffer;
  /** image/png ou image/jpeg */
  mediaType: 'image/png' | 'image/jpeg';
  briefing: string;
  /** O que preservar/priorizar, se o CreativeSpec trouxer (seção 20: productIntegrity/identityIntegrity só fazem sentido quando isso importa pro job). */
  identityCritical?: boolean;
  productCritical?: boolean;
}

export async function runVisualQA(input: VisualQAInput): Promise<VisualQAResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new VisualQAUnavailableError('ANTHROPIC_API_KEY não configurada no ambiente do studio-node');
  }

  const client = new Anthropic({ apiKey });
  const criticalNote = [input.identityCritical && 'identidade do sujeito é CRÍTICA', input.productCritical && 'integridade do produto é CRÍTICA']
    .filter(Boolean)
    .join('; ');

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBytes.toString('base64') } },
          {
            type: 'text',
            text: `Briefing/prompt original: "${input.briefing}"${criticalNote ? `\nRestrições: ${criticalNote}.` : ''}`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Visual QA: resposta do Claude não trouxe bloco de texto');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (error) {
    throw new Error(`Visual QA: resposta não é JSON válido - ${String(error)}\nraw: ${textBlock.text}`);
  }

  return visualQAResultSchema.parse(parsed);
}
