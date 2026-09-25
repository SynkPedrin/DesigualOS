import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { AgentName } from '@desigual-os/types';
import type { Logger } from '@desigual-os/logging';
import {
  briefHasDirection,
  createMotion,
  detectMotionIntent,
  extractCampaignBriefFromMessage,
  findConversationMotion,
  isMotionError,
  ottoMotionEnabled,
  summarizeClientContext,
  updateMotion,
  userMessageFor,
  type CampaignBrief,
  type ClientContextSummary,
  type MotionIntent,
  type MotionSession,
} from '@desigual-os/otto-motion';

/**
 * PONTE OTTO -> MOTION ENGINE.
 *
 * Este arquivo é a ÚNICA coisa que o worker do Desigual sabe sobre motion.
 * Ele é chamado no mesmo lugar e do mesmo jeito que os outros guards de
 * fast-path do `processSingleAgentJob` (registro de conhecimento, small talk,
 * ação do Bento): devolve `ExecuteResponse` quando assume o turno, e `null`
 * quando não é com ele.
 *
 * `null` é o caminho de volta pro comportamento de hoje, byte a byte — é o
 * que torna a regressão do §46 verificável: com a flag desligada, a PRIMEIRA
 * linha já devolve null e nada mais deste módulo é sequer carregado.
 */
export interface MotionGuardParams {
  agent: AgentName;
  message: string;
  executionId: string;
  conversationId: string | null;
  clientId: string | null;
  userId: string | null;
  projectId: string | null;
  /**
   * Briefing estruturado do card de briefing (POST /chat `motion_brief` → job
   * data `motionBrief`). AUSENTE num pedido de criação novo é o que dispara o
   * card: em vez de abrir uma sessão com brief vazio, o guard responde com
   * `metadata.motion_brief_request` e a web desenha o formulário.
   */
  brief?: CampaignBrief | undefined;
  attachments: { url: string; filename: string; contentType: string }[];
  logger: Logger;
}

export async function tryMotionGuard(params: MotionGuardParams): Promise<ExecuteResponse | null> {
  // Ordem deliberada: a checagem mais barata primeiro. Com a flag desligada
  // não há consulta ao banco, nem detecção, nem import de nada pesado.
  if (!ottoMotionEnabled()) return null;
  if (params.agent !== 'otto') return null;

  const { logger, executionId, conversationId } = params;

  // Pré-detecção sem sessão: cobre o pedido explícito ("faz um motion de
  // 15s") sem ir ao banco. Só quando ela não decide é que vale a consulta
  // pela sessão ativa, que é o que habilita o caminho de ajuste (§17).
  let intent: MotionIntent | null = detectMotionIntent(params.message, { hasActiveSession: false });
  let active: MotionSession | null = null;

  if (conversationId) {
    active = await findConversationMotion(conversationId).catch((error: unknown) => {
      logger.warn({ executionId, error }, 'Motion: não consegui consultar a sessão da conversa');
      return null;
    });
    if (active) {
      intent = detectMotionIntent(params.message, { hasActiveSession: true });
    }
  }

  if (!intent) return null;

  logger.info(
    { executionId, kind: intent.kind, reason: intent.reason, motionId: active?.id ?? null },
    'Motion: turno classificado como pedido de motion',
  );

  try {
    if (intent.kind === 'update' && active) {
      const session = await updateMotion(
        {
          motionId: active.id,
          instruction: params.message,
          requestedBy: params.userId,
          executionId,
          references: params.attachments,
        },
        logger,
      );
      return respond(params, session, ackForUpdate(params.message), intent);
    }

    if (!params.clientId) {
      // §26 — erro amigável com o próximo passo, não 500. Não abre sessão:
      // motion sem cliente não tem marca, e adivinhar a marca é exatamente o
      // que o CLAUDE.md deste projeto proíbe.
      return plainAnswer(
        params,
        'Pra fazer o motion eu preciso saber de qual cliente é a peça — sem isso eu não tenho marca, cor nem material pra trabalhar. Seleciona o cliente aqui no chat e eu começo.',
        { motion_blocked: 'no_client' },
      );
    }

    let brief = params.brief;
    let briefWasAutoExtracted = false;

    if (intent.kind === 'create' && !brief) {
      // CHAT-FIRST (adendo "Otto Motion via chat direto, sem formulário"):
      // antes de abrir o card, tenta montar o briefing sozinho a partir do
      // que a pessoa já escreveu. Só cai pro card se a extração falhar ou
      // não trouxer direção nenhuma (§briefHasDirection) — nunca abre o
      // card quando o pedido já está claro, e crucialmente NUNCA perde os
      // anexos deste turno pra um turno futuro de resposta ao card.
      const extracted = await extractCampaignBriefFromMessage(params.message, logger).catch((error: unknown) => {
        logger.warn({ executionId, error }, 'Motion: extração automática de briefing falhou; caindo pro card');
        return null;
      });

      if (extracted && briefHasDirection(extracted)) {
        brief = extracted;
        briefWasAutoExtracted = true;
        logger.info(
          { executionId, campaignName: extracted.campaignName ?? null },
          'Motion: briefing extraído automaticamente do chat — pulando o card',
        );
      } else {
        // PEDIDO DE BRIEFING (card) — fallback, comportamento anterior
        // preservado byte a byte quando a extração não tem o que trabalhar.
        const summary = await summarizeClientContext(params.clientId).catch((error: unknown) => {
          logger.warn({ executionId, error }, 'Motion: resumo do contexto do cliente falhou; respondendo genérico');
          return null;
        });
        return briefRequest(params, intent, summary);
      }
    }

    const session = await createMotion(
      {
        clientId: params.clientId,
        conversationId,
        projectId: params.projectId,
        requestedBy: params.userId,
        executionId,
        prompt: params.message,
        ...(brief ? { brief } : {}),
        ...(intent.durationSeconds !== undefined ? { durationSeconds: intent.durationSeconds } : {}),
        ...(intent.format !== undefined ? { format: intent.format } : {}),
        ...(intent.fps !== undefined ? { fps: intent.fps } : {}),
        references: params.attachments,
      },
      logger,
    );

    return respond(params, session, ackForCreate(session, brief, briefWasAutoExtracted, params.attachments), intent);
  } catch (error) {
    // Falha aqui vira RESPOSTA, não exceção: o §26 é explícito, e deixar
    // subir marcaria a execution como failed e o BullMQ reprocessaria o
    // turno inteiro — criando um SEGUNDO motion pro mesmo pedido.
    const message = userMessageFor(error);
    const code = isMotionError(error) ? error.code : 'INTERNAL';
    logger.error({ executionId, code, detail: isMotionError(error) ? error.detail : String(error) }, 'Motion: guard falhou');
    return plainAnswer(params, message, {
      motion_error: code,
      motion_actions: isMotionError(error) ? error.actions : [],
    });
  }
}

/**
 * Recibo do que foi ENTENDIDO, não um formulário disfarçado de mensagem —
 * mesma régua do adendo chat-first: "Otto deve ser objetivo", mostrando os
 * campos que ele já capturou (auto-extraídos ou do card) em vez de abrir
 * mais perguntas. `briefWasAutoExtracted` decide só o texto de abertura;
 * o corpo com os campos é o mesmo formato pros dois casos.
 */
function ackForCreate(
  session: MotionSession,
  brief: CampaignBrief | undefined,
  briefWasAutoExtracted: boolean,
  attachments: { url: string; filename: string; contentType: string }[] = [],
): string {
  const abertura = briefWasAutoExtracted
    ? `🎬 Entendi. Vou gerar${brief?.campaignName ? ` o motion da campanha "${brief.campaignName}"` : ' um motion'} com base no que você escreveu.`
    : brief?.campaignName
      ? `Vou fazer o motion da campanha "${brief.campaignName}" — peça de ${session.durationSeconds} segundos em ${session.format} (${session.width}x${session.height}).`
      : `Vou fazer. Peça de ${session.durationSeconds} segundos em ${session.format} (${session.width}x${session.height}).`;

  if (!briefWasAutoExtracted) {
    return [abertura, '', 'Estou lendo a marca e separando o material do cliente agora. Te mostro o preview assim que a primeira versão sair.'].join('\n');
  }

  const campos: string[] = [];
  if (brief?.objective) campos.push(`Objetivo: ${brief.objective}`);
  if (brief?.offer?.price) campos.push(`Valor: ${brief.offer.price}`);
  if (brief?.offer?.condition) campos.push(`Condição: ${brief.offer.condition}`);
  if (brief?.cta) campos.push(`CTA: ${brief.cta}`);
  campos.push(`Formato: ${session.format}`);
  campos.push(`Duração: ${session.durationSeconds}s`);
  if (brief?.tone) campos.push(`Tom: ${brief.tone}`);

  const referencias = attachments.length > 0 ? ['', 'Referências visuais detectadas:', ...attachments.map((a) => `- ${a.filename}`)] : [];

  return [
    abertura,
    '',
    ...campos,
    ...referencias,
    '',
    attachments.length > 0
      ? 'Estou usando o que você anexou como referência obrigatória e separando o resto do material do cliente agora. Te mostro o preview assim que a primeira versão sair.'
      : 'Estou lendo a marca e separando o material do cliente agora. Te mostro o preview assim que a primeira versão sair.',
  ].join('\n');
}

/**
 * Resposta do caso "create sem brief": NÃO abre sessão, só devolve o pedido de
 * briefing que a web usa pra desenhar o card. O prefill vem do que a detecção
 * leu da frase ("motion de 15s em 16:9 a 60fps") pra pessoa não redigitar.
 */
function briefRequest(params: MotionGuardParams, intent: MotionIntent, summary: ClientContextSummary | null): ExecuteResponse {
  const prefill: Record<string, unknown> = {};
  if (intent.durationSeconds !== undefined) prefill.duration = intent.durationSeconds;
  if (intent.format !== undefined) prefill.aspectRatio = intent.format;
  if (intent.fps !== undefined) prefill.fps = intent.fps;

  return {
    execution_id: params.executionId,
    agent: 'otto',
    status: 'completed',
    answer: briefRequestAnswer(summary),
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    metadata: {
      fast_path: 'motion_request',
      motion_intent: 'create',
      motion_intent_reason: intent.reason,
      motion_brief_request: {
        client_id: params.clientId,
        prefill,
      },
    },
  };
}

function briefRequestAnswer(summary: ClientContextSummary | null): string {
  const fechamento = 'Pra montar o anúncio preciso só das informações desta campanha.';
  if (!summary) {
    return `Pra montar o anúncio preciso das informações desta campanha — preenche o card e eu começo a produzir.`;
  }
  const achados: string[] = [];
  if (summary.hasBrandKit) achados.push('✓ identidade visual');
  if (summary.logoUrl) achados.push('✓ logo');
  if (summary.images > 0) achados.push(`✓ ${summary.images} ${summary.images === 1 ? 'imagem' : 'imagens'}`);
  if (summary.videos > 0) achados.push(`✓ ${summary.videos} ${summary.videos === 1 ? 'vídeo' : 'vídeos'}`);
  if (summary.hasBrain) achados.push('✓ brain criativo');
  const nome = summary.clientName;
  if (achados.length === 0) {
    return `O cliente ${nome ?? 'selecionado'} ainda não tem material registrado (identidade, logo, imagens) — dá pra começar mesmo assim, mas o resultado sai melhor com o acervo em dia. ${fechamento}`;
  }
  const intro = nome ? `Encontrei os materiais da ${nome}` : 'Encontrei os materiais do cliente selecionado';
  return `${intro}: ${achados.join(' ')}. ${fechamento}`;
}

function ackForUpdate(instruction: string): string {
  const short = instruction.trim().replace(/\s+/g, ' ').slice(0, 120);
  return `Entendi: ${short}\n\nEstou ajustando o projeto que já existe — só essa parte, o resto fica como está.`;
}

function respond(
  params: MotionGuardParams,
  session: MotionSession,
  answer: string,
  intent: MotionIntent,
): ExecuteResponse {
  return {
    execution_id: params.executionId,
    agent: 'otto',
    status: 'completed',
    answer,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    metadata: {
      fast_path: 'motion_request',
      motion_intent: intent.kind,
      motion_intent_reason: intent.reason,
      // Este bloco é o que a web lê pra desenhar o player (§40). Fica na
      // metadata da MENSAGEM, então sobrevive a recarregar a página.
      motion: {
        motion_id: session.id,
        status: session.status,
        format: session.format,
        duration_seconds: session.durationSeconds,
        fps: session.fps,
        width: session.width,
        height: session.height,
        render_version: session.renderVersion,
      },
    },
  };
}

function plainAnswer(params: MotionGuardParams, answer: string, metadata: Record<string, unknown>): ExecuteResponse {
  return {
    execution_id: params.executionId,
    agent: 'otto',
    status: 'completed',
    answer,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    metadata: { fast_path: 'motion_request', ...metadata },
  };
}
