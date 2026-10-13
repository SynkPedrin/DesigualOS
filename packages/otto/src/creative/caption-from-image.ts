import { z } from 'zod';
import {
  callResponses,
  isOpenAICredentialConfigured,
  pickModel,
} from '@desigual-os/openai-provider';
import type { FastifyBaseLogger } from 'fastify';
import type { BrandKit } from './dna.js';

/** Interface mínima e estrutural (não a Logger completa do pino/@desigual-os/logging):
 * quem chama isto é normalmente uma rota Fastify passando request.log, cujo tipo
 * (FastifyBaseLogger) não bate 1:1 com o Logger do pino - só warn/error importam aqui. */
export interface CaptionLogger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface GenerateImageCaptionInput {
  /** URL pública da imagem já gerada (Supabase Storage) - a legenda olha o resultado real, não só o briefing. */
  imageUrl: string;
  /** Briefing/prompt original que pediu essa peça. */
  briefing: string;
  brandKit?: Pick<BrandKit, 'toneOfVoice' | 'restrictions'> | null;
  logger?: CaptionLogger;
}

const generatedCaptionSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
});

export type GeneratedImageCaption = z.infer<typeof generatedCaptionSchema>;

function buildSystemPrompt(brandKit?: GenerateImageCaptionInput['brandKit']): string {
  const toneLine = brandKit?.toneOfVoice
    ? `Tom de voz da marca deste cliente: ${brandKit.toneOfVoice}.`
    : 'Nenhum tom de voz de marca foi registrado para este cliente ainda - use um tom profissional e natural, sem inventar um estilo específico (ex: não assuma humor, não assuma referência musical, não assuma nenhuma persona que não veio do cliente).';
  const restrictionsLine = brandKit?.restrictions?.length
    ? `Nunca use, mencione ou sugira: ${brandKit.restrictions.join(', ')}.`
    : '';

  return [
    'Você é Otto, diretor de criação da Desigual, escrevendo a legenda de Instagram de uma peça que acabou de ser gerada para um cliente real da agência.',
    'Olhe a imagem anexada com atenção real (composição, elementos, pessoas, produto, texto visível, clima) e escreva a legenda com base no que você efetivamente VÊ nela, não só no briefing em texto.',
    toneLine,
    restrictionsLine,
    'Sem emoji em excesso, sem clichê genérico de agência ("confira", "não perca", "arrasou"), sem inventar oferta, preço ou condição comercial que não esteja no briefing.',
    'Responda SÓ com um JSON no formato exato: {"caption": string, "hashtags": string[]}. Sem markdown, sem texto fora do JSON.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Legenda gerada sob demanda por um botão manual - nunca automaticamente na
 * criação do job (achado da certificação de pré-release, 2026-09-09/10: a
 * geração automática anterior, generateStudioCopy em packages/router, usava
 * uma persona fixa "Cinema Impossível" e nunca olhava a imagem de verdade, só
 * o texto do briefing - por isso clientes sem nenhuma relação com aquele
 * projeto, ex: John Deere, recebiam legenda sobre letra de música). Esta
 * função manda a imagem de verdade pro modelo (visão) e usa o BrandKit real
 * do cliente em vez de uma persona hardcoded.
 *
 * Mesma ressalva de packages/router/src/classifier.ts: implementação segue a
 * API documentada do SDK, mas não foi validada contra uma chamada real nesta
 * sessão. Testar contra uma chave real antes de confiar em produção.
 *
 * Migrou de Anthropic pra OpenAI em 13/10/2026, por decisão do Pedro: "não
 * vai utilizar anthropic api key, e sim o gpt". A imagem vai como parte
 * `input_image` da Responses API; o modelo sai da mesma escada de custo do
 * resto do Otto (pickModel), não de uma escolha solta aqui.
 */
export async function generateImageCaption(input: GenerateImageCaptionInput): Promise<GeneratedImageCaption | null> {
  if (!isOpenAICredentialConfigured()) {
    input.logger?.warn('OPENAI_API_KEY não configurada; legenda de imagem indisponível');
    return null;
  }

  const decision = pickModel('otto_creative_normal', 'normal');
  const logger = (input.logger ?? console) as unknown as FastifyBaseLogger;

  const result = await callResponses(
    {
      model: decision.model,
      instructions: `${buildSystemPrompt(input.brandKit)}\n\nResponda SOMENTE com um JSON válido, sem markdown, sem texto antes ou depois.`,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: input.imageUrl, detail: 'auto' },
            { type: 'input_text', text: `Briefing original desta peça: ${input.briefing || '(nenhum briefing registrado)'}` },
          ],
        },
      ],
      maxOutputTokens: 512,
    },
    logger,
  );

  const texto = result.outputText.trim();
  if (!texto) {
    input.logger?.error({ responseId: result.responseId }, 'generateImageCaption: resposta sem texto');
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(texto);
    return generatedCaptionSchema.parse(parsed);
  } catch (error) {
    input.logger?.error({ error, raw: texto }, 'generateImageCaption: resposta não parseável');
    return null;
  }
}
