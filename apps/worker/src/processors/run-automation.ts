import { and, eq, isNull } from 'drizzle-orm';
import { hasPermission, loadUserAccess } from '@desigual-os/auth';
import type { Job } from 'bullmq';
import { db, schema } from '@desigual-os/database';
import { buildContext, formatContextForPrompt } from '@desigual-os/context-engine';
import { dispatchChatMessage, touchConversation, type AutomationJobData } from '@desigual-os/orchestrator';
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
      .values({ conversationId, role: 'user', content: automation.prompt });
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
  });
  const contextBlock = formatContextForPrompt(context);
  const messageWithContext = contextBlock
    ? `${automation.prompt}\n\n---\nContexto:\n${contextBlock}`
    : automation.prompt;

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
