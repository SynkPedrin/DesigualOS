import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { AgentName } from '@desigual-os/types';
import type { Logger } from '@desigual-os/logging';
import {
  createMotion,
  detectMotionIntent,
  findConversationMotion,
  isMotionError,
  ottoMotionEnabled,
  updateMotion,
  userMessageFor,
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

    const session = await createMotion(
      {
        clientId: params.clientId,
        conversationId,
        projectId: params.projectId,
        requestedBy: params.userId,
        executionId,
        prompt: params.message,
        ...(intent.durationSeconds !== undefined ? { durationSeconds: intent.durationSeconds } : {}),
        ...(intent.format !== undefined ? { format: intent.format } : {}),
        ...(intent.fps !== undefined ? { fps: intent.fps } : {}),
        references: params.attachments,
      },
      logger,
    );

    return respond(params, session, ackForCreate(session), intent);
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

function ackForCreate(session: MotionSession): string {
  return [
    `Vou fazer. Peça de ${session.durationSeconds} segundos em ${session.format} (${session.width}x${session.height}).`,
    '',
    'Estou lendo a marca e separando o material do cliente agora. Te mostro o preview assim que a primeira versão sair.',
  ].join('\n');
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
