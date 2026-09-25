import type { Logger } from '@desigual-os/logging';
import { callResponses, isOpenAICredentialConfigured, pickModel } from '@desigual-os/openai-provider';
import { campaignBriefSchema, type CampaignBrief } from './schema.js';

/**
 * extract.ts — CHAT-FIRST (adendo "Otto Motion via chat direto, sem
 * formulário"). Antes desta peça, `!params.brief` em motion-guard.ts SEMPRE
 * abria o card de briefing, mesmo quando a pessoa já tinha escrito um pedido
 * completo com campanha, valor, condição e CTA na própria mensagem — e é
 * exatamente essa interrupção que fazia as imagens anexadas naquele MESMO
 * turno se perderem: o card reabre a conversa num turno novo, e o
 * `references` que chega em `createMotion` depois é o do turno da resposta
 * ao card, não o da mensagem original com as fotos.
 *
 * Esta função tenta extrair um `CampaignBrief` estruturado do texto livre
 * ANTES de decidir abrir o card. Sucesso com direção suficiente
 * (`briefHasDirection`) = cria o motion no mesmo turno, com os MESMOS
 * anexos. Sem sinal suficiente = cai pro card como hoje, sem regressão.
 *
 * Chamada SEM tools (mesma regra de `packages/router/src/safe-complete.ts`
 * e do provider do Otto): é extração de texto, o modelo não tem como
 * executar nada.
 */
const EXTRACT_INSTRUCTIONS = `Você extrai um briefing de campanha estruturado de uma mensagem de chat em português, para produção de um vídeo/motion publicitário. Você NÃO gera o vídeo, NÃO tem ferramentas, só devolve um JSON.

Responda SOMENTE com um JSON no formato:
{
  "campaignName": string opcional,
  "objective": string opcional,
  "offer": { "name", "price", "originalPrice", "installments", "installmentValue", "discount", "condition" — todos opcionais } opcional,
  "cta": string opcional,
  "audience": string opcional,
  "platform": string opcional,
  "aspectRatio": "9:16" | "4:5" | "1:1" | "16:9" opcional,
  "duration": número em segundos opcional,
  "fps": 24 | 30 | 60 opcional,
  "tone": string opcional,
  "notes": string opcional
}

Regra que não se negocia (nunca alucinar dado comercial): se o texto disser um VALOR, uma CONDIÇÃO ou um CTA específico, copie EXATAMENTE como está escrito — nunca arredonde, nunca troque a moeda, nunca invente uma condição que não foi dita. Campo que o texto não menciona fica AUSENTE (não escreva a chave), nunca um valor genérico ou "a combinar".

Você PODE inferir com bom senso (isto não é alucinação, é interpretação do pedido): tom (se o texto disser "premium", "cinematográfico" etc.), CTA comercial seguro quando o pedido claramente pede venda mas não escreveu um CTA literal (ex: "Saiba mais", "Fale conosco"), e objetivo (conversão/promoção/tráfego/institucional) a partir do que a pessoa está pedindo. Não inclua "notes" com observações vazias ou óbvias — só quando há uma direção criativa real que não coube nos outros campos.`;

/** Falha vira `null`, nunca exceção: falta de extração cai pro card do jeito antigo, não quebra o turno. */
export async function extractCampaignBriefFromMessage(message: string, logger: Logger): Promise<CampaignBrief | null> {
  if (!isOpenAICredentialConfigured()) {
    logger.warn?.('Motion: extração automática de briefing indisponível (OPENAI_API_KEY ausente) — caindo pro card');
    return null;
  }

  try {
    const decision = pickModel('simple_extraction', 'normal');
    const result = await callResponses(
      {
        model: decision.model,
        instructions: EXTRACT_INSTRUCTIONS,
        input: message,
        maxOutputTokens: 500,
      },
      logger as never,
    );

    const parsed: unknown = JSON.parse(result.outputText);
    const validated = campaignBriefSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn?.({ error: validated.error.message }, 'Motion: extração de briefing não bateu com o schema — caindo pro card');
      return null;
    }
    return validated.data;
  } catch (error) {
    logger.warn?.({ error }, 'Motion: extração automática de briefing falhou — caindo pro card');
    return null;
  }
}
