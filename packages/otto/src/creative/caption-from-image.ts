import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { BrandKit } from './dna.js';

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

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

function detectMediaType(url: string, contentType: string | null): ImageMediaType {
  if (contentType && (IMAGE_MEDIA_TYPES as readonly string[]).includes(contentType)) {
    return contentType as ImageMediaType;
  }
  const ext = (url.split('?')[0] ?? url).split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

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
 * sessão (sem ANTHROPIC_API_KEY configurada/testável no ambiente de auditoria
 * onde isto foi escrito). Testar contra uma chave real antes de confiar em
 * produção.
 */
export async function generateImageCaption(input: GenerateImageCaptionInput): Promise<GeneratedImageCaption | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    input.logger?.warn('ANTHROPIC_API_KEY not configured, image caption unavailable');
    return null;
  }

  const imageResponse = await fetch(input.imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Não consegui baixar a imagem para análise (HTTP ${imageResponse.status}).`);
  }
  const mediaType = detectMediaType(input.imageUrl, imageResponse.headers.get('content-type'));
  const base64Data = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: buildSystemPrompt(input.brandKit),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: `Briefing original desta peça: ${input.briefing || '(nenhum briefing registrado)'}` },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    input.logger?.error({ response }, 'generateImageCaption: resposta sem bloco de texto');
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(textBlock.text);
    return generatedCaptionSchema.parse(parsed);
  } catch (error) {
    input.logger?.error({ error, raw: textBlock.text }, 'generateImageCaption: resposta não parseável');
    return null;
  }
}
