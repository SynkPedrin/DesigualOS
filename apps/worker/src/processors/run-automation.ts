import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { hasPermission, loadUserAccess, organizacaoDaConversa, organizacaoDaEscrita } from '@desigual-os/auth';
import type { Job } from 'bullmq';
import { db, schema } from '@desigual-os/database';
import { buildContext, formatContextForPrompt } from '@desigual-os/context-engine';
import { enviarPeloBento, formatarParaWhatsapp } from '@desigual-os/tool-gateway';
import { dispatchChatMessage, touchConversation, type AutomationJobData } from '@desigual-os/orchestrator';
import { resolveEnvironment } from './environment';
import type { RouterDecision } from '@desigual-os/router';
import type { AgentName } from '@desigual-os/types';
import type { Logger } from '@desigual-os/logging';

function manualDecision(agent: AgentName): RouterDecision {
  return {
    intent: 'automation_trigger',
    primary_agent: agent,
    required_tools: [],
    context: [],
    estimated_complexity: 'medium',
    workflow: null,
    confidence: 1,
    source: 'manual',
  };
}

/**
 * Dispara uma automação agendada (pedido do usuário, 2026-09-03): reusa o
 * MESMO caminho de POST /chat (dispatchChatMessage) na conversa dedicada da
 * automação, então a resposta vira mensagem de chat normal e a notificação
 * de "terminei" (execute-job.ts -> notifyChatCompletion) acontece de graça,
 * sem duplicar aquele pipeline aqui.
 */
export async function processAutomationJob(
  job: Job<AutomationJobData>,
  logger: Logger,
): Promise<void> {
  const { automationId } = job.data;
  const [automation] = await db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, automationId));
  if (!automation) {
    logger.warn(
      { automationId },
      'Automation job fired for an automation that no longer exists, skipping',
    );
    return;
  }
  if (!automation.enabled && job.data.manual !== true) {
    // Disparo manual é intenção explícita do usuário - não pula por enabled=false.
    logger.info({ automationId }, 'Automation is disabled, skipping this fire');
    return;
  }

  // Queue payloads identify a record; authority is reloaded when it runs.
  // A revoked membership must not leave an old schedule able to act.
  const [member] = automation.organizationId ? await db
    .select({ id: schema.organizationMembers.id })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, automation.organizationId),
      eq(schema.organizationMembers.userId, automation.createdBy),
      eq(schema.users.active, true), isNull(schema.users.deletedAt))) : [];
  const access = member ? await loadUserAccess(automation.createdBy) : null;
  let authorized = Boolean(member && access && hasPermission(access.permissions, 'chat', 'write'));
  if (authorized && automation.clientId) {
    const [client] = await db.select({ id: schema.clients.id }).from(schema.clients)
      .where(and(eq(schema.clients.id, automation.clientId), eq(schema.clients.organizationId, automation.organizationId!), isNull(schema.clients.deletedAt)));
    authorized = Boolean(client);
  }
  if (authorized && automation.conversationId) {
    const [conversation] = await db.select({ id: schema.conversations.id }).from(schema.conversations)
      .where(and(eq(schema.conversations.id, automation.conversationId), eq(schema.conversations.userId, automation.createdBy),
        automation.clientId ? eq(schema.conversations.clientId, automation.clientId) : isNull(schema.conversations.clientId)));
    authorized = Boolean(conversation);
  }
  if (!authorized) {
    await db.insert(schema.automationRuns).values({ automationId: automation.id, status: 'failed', error: 'Automation authorization revoked or inconsistent resource scope', completedAt: new Date() });
    logger.warn({ automationId, organizationId: automation.organizationId }, 'Automation authorization denied');
    return;
  }

  let conversationId = automation.conversationId;
  if (!conversationId) {
    // Defensivo: normalmente já existe desde a criação (POST /automations), mas nada
    // impede uma automação antiga sem conversa vinculada.
    const [conversation] = await db
      .insert(schema.conversations)
      .values({
        organizationId: await organizacaoDaEscrita({
          userId: automation.createdBy,
          clientId: automation.clientId,
        }),
        userId: automation.createdBy,
        clientId: automation.clientId,
        title: `Automação: ${automation.name}`,
      })
      .returning();
    conversationId = conversation?.id ?? null;
    if (conversationId) {
      await db
        .update(schema.automations)
        .set({ conversationId })
        .where(eq(schema.automations.id, automation.id));
    }
  }

  if (conversationId) {
    await db
      .insert(schema.messages)
      // Herda da conversa, não deduz de novo. Ver organizacaoDaConversa.
      .values({
        conversationId,
        organizationId: await organizacaoDaConversa(conversationId),
        role: 'user',
        content: automation.prompt,
      });
    await touchConversation(conversationId);
  }

  // Mesmo enriquecimento de contexto do POST /chat (chat/routes.ts): sem
  // isso a automação despachava o prompt cru e o agente não sabia nem de
  // qual cliente se tratava (medido em 03/09: Jarbas respondeu "sobre qual
  // cliente você tá falando?" numa automação com clientId vinculado).
  const context = await buildContext({
    userId: automation.createdBy,
    clientId: automation.clientId,
    conversationId,
    agent: automation.agent,
    // buildContext resolve o ambiente pelo cliente quando omitido; aqui ele já
    // está resolvido pelo mesmo helper do resto do worker, então viaja explícito.
    environment: await resolveEnvironment(automation.clientId).catch(() => 'production' as const),
  });
  const messageWithContext = mensagemDaAutomacao(automation.prompt, automation.agent, formatContextForPrompt(context));

  const startedAt = new Date();
  try {
    const result = await dispatchChatMessage({
      message: messageWithContext,
      userId: automation.createdBy,
      clientId: automation.clientId,
      conversationId,
      decision: manualDecision(automation.agent),
    });

    await db.insert(schema.automationRuns).values({
      automationId: automation.id,
      status: result.status === 'unavailable' ? 'failed' : 'dispatched',
      executionCode: result.executionId,
      error:
        result.status === 'unavailable' ? (result.error ?? 'Agente indisponível no momento') : null,
      startedAt,
      completedAt: new Date(),
    });
    await db
      .update(schema.automations)
      .set({ lastRunAt: startedAt })
      .where(eq(schema.automations.id, automation.id));

    if (result.status === 'unavailable') {
      logger.warn({ automationId, error: result.error }, 'Automation dispatch unavailable');
    } else {
      logger.info({ automationId, executionId: result.executionId }, 'Automation dispatched');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.insert(schema.automationRuns).values({
      automationId: automation.id,
      status: 'failed',
      error: message,
      startedAt,
      completedAt: new Date(),
    });
    await db
      .update(schema.automations)
      .set({ lastRunAt: startedAt })
      .where(eq(schema.automations.id, automation.id));
    logger.error({ automationId, error: message }, 'Automation dispatch threw');
    throw error;
  }
}

/**
 * A MENSAGEM DA AUTOMAÇÃO É O PROMPT DELA — a mesma regra do chat
 * (apps/api/src/chat/message-assembly.ts, `contextoGeralVaiNaMensagem`).
 *
 * Medido em produção em 13/10/2026: a única automação ativa, de hora em hora
 * para o Bento, falhou nos 6 disparos do dia — 5 vezes em `target_unresolved`
 * ("essa"/"ela" sem referente) e 1 na trava de escrita (verbo de despacho e
 * de agendamento). A automação colava o bloco de contexto INTEIRO na
 * mensagem, inclusive o histórico da própria conversa dela, e as travas do
 * Bento liam esse texto como se fosse o pedido. Cada hora que falhava
 * deixava no histórico uma resposta pedindo esclarecimento, que contaminava a
 * hora seguinte. O registro da execução dizia `dispatched`.
 *
 * No chat isso foi resolvido em setembro para todos os agentes menos o
 * Studio; aqui ficou para trás. O conhecimento continua chegando pelo
 * caminho estruturado do worker (dossiê pelo clientId, ContextPack, bloco de
 * pessoa e equipe do Bento), não por texto colado.
 */
export function mensagemDaAutomacao(prompt: string, agent: AgentName, contextBlock: string): string {
  if (agent !== 'studio' || !contextBlock) return prompt;
  return `${prompt}\n\n---\nContexto:\n${contextBlock}`;
}

/**
 * A RESPOSTA DA AUTOMAÇÃO TAMBÉM VAI PARA O WHATSAPP de quem pediu (pedido do
 * Pedro, 23/10/2026), quando a automação tem `whatsappPhone`.
 *
 * É a única vez que o Bento escreve primeiro, e por isso é estreita:
 *  - só a execução que É um disparo da automação (tem `automation_runs` com
 *    este executionCode). Alguém conversando à mão na conversa da automação
 *    não recebe eco no celular;
 *  - só para o número gravado NA automação, que a própria pessoa digitou;
 *  - pelo `enviarPeloBento`, com as travas dele (canal ligado, sessão pronta,
 *    limite por janela). Sem canal, a resposta fica só no chat, como antes.
 *
 * O run é gravado DEPOIS do despacho (processAutomationJob), então uma
 * resposta muito rápida pode chegar antes dele: uma segunda olhada resolve.
 */
export async function entregarAutomacaoNoWhatsapp(
  input: { conversationId: string | null; executionId: string; answer: string | null; falhou: boolean },
  logger: Logger,
  deps: { enviar?: typeof enviarPeloBento; esperar?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const enviar = deps.enviar ?? enviarPeloBento;
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const answer = input.answer?.trim();
  if (!input.conversationId || !answer) return;
  try {
    const [automation] = await db
      .select({ id: schema.automations.id, name: schema.automations.name, whatsappPhone: schema.automations.whatsappPhone })
      .from(schema.automations)
      .where(and(eq(schema.automations.conversationId, input.conversationId), isNotNull(schema.automations.whatsappPhone)));
    if (!automation?.whatsappPhone) return;

    const ehDisparo = async () => {
      const [run] = await db
        .select({ id: schema.automationRuns.id })
        .from(schema.automationRuns)
        .where(and(eq(schema.automationRuns.automationId, automation.id), eq(schema.automationRuns.executionCode, input.executionId)));
      return Boolean(run);
    };
    if (!(await ehDisparo())) {
      await esperar(3_000);
      if (!(await ehDisparo())) return;
    }

    const titulo = input.falhou ? `*Automação “${automation.name}” não rodou*` : `*Automação “${automation.name}”*`;
    const partes = formatarParaWhatsapp(`${titulo}\n\n${answer}`);
    for (const [indice, parte] of partes.entries()) {
      const resultado = await enviar({
        phone: automation.whatsappPhone,
        text: parte,
        idempotencyKey: `automacao:${input.executionId}:${indice}`,
      });
      if (!resultado.ok) {
        logger.warn({ automationId: automation.id, motivo: resultado.motivo, erro: resultado.erro }, 'automação: não entreguei no WhatsApp; a resposta continua no chat');
        return;
      }
    }
    logger.info({ automationId: automation.id, partes: partes.length }, 'automação: resposta entregue no WhatsApp');
  } catch (error) {
    // Entrega no celular é acessório: a resposta já está gravada no chat.
    logger.warn({ error, executionId: input.executionId }, 'automação: falha ao entregar no WhatsApp');
  }
}
