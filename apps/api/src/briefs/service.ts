import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { resolveTaskProvider } from '@desigual-os/tool-gateway';
import { recordOperationalEvent } from '@desigual-os/orchestrator';
import type { BriefContent } from '@desigual-os/types';

/**
 * briefs/service.ts — Brief + BriefVersion + Brief→Task (P1-E/F/G,
 * 06/10/2026). Versão nova SEMPRE, nunca sobrescrita (plano de execução
 * §P1.5): mesmo um brief com 1 versão só já tem a estrutura pronta pra
 * nunca perder histórico quando a 2ª chegar.
 */

type BriefRow = typeof schema.briefs.$inferSelect;
type BriefVersionRow = typeof schema.briefVersions.$inferSelect;

export async function createBrief(input: {
  organizationId: string;
  clientId: string;
  demandId: string;
  conversationThreadId: string | null;
  createdBy: string;
  content: BriefContent;
  source: 'ai_draft' | 'human_edit';
  sourceEvidence?: Record<string, unknown> | null;
}): Promise<{ brief: BriefRow; version: BriefVersionRow }> {
  const [brief] = await db
    .insert(schema.briefs)
    .values({
      organizationId: input.organizationId,
      clientId: input.clientId,
      demandId: input.demandId,
      conversationThreadId: input.conversationThreadId,
      createdBy: input.createdBy,
    })
    .returning();

  const [version] = await db
    .insert(schema.briefVersions)
    .values({
      briefId: brief!.id,
      version: 1,
      content: input.content,
      source: input.source,
      sourceEvidence: input.sourceEvidence ?? null,
      createdBy: input.createdBy,
    })
    .returning();

  await db.update(schema.demands).set({ status: 'briefing' }).where(eq(schema.demands.id, input.demandId));

  await recordOperationalEvent({
    source: 'system',
    type: 'brief.created',
    organizationId: input.organizationId,
    userId: input.createdBy,
    clientId: input.clientId,
    entityType: 'brief',
    entityId: brief!.id,
    summary: 'Criou um briefing.',
  });

  return { brief: brief!, version: version! };
}

export async function addBriefVersion(input: {
  organizationId: string;
  briefId: string;
  content: BriefContent;
  source: 'ai_draft' | 'human_edit';
  sourceEvidence?: Record<string, unknown> | null;
  createdBy: string;
}): Promise<BriefVersionRow | null> {
  const brief = await getBrief(input.organizationId, input.briefId);
  if (!brief) return null;

  const [ultima] = await db
    .select({ version: schema.briefVersions.version })
    .from(schema.briefVersions)
    .where(eq(schema.briefVersions.briefId, input.briefId))
    .orderBy(asc(schema.briefVersions.version));
  const numeroDaProxima = (ultima?.version ?? 0) + 1;

  const [nova] = await db
    .insert(schema.briefVersions)
    .values({
      briefId: input.briefId,
      version: numeroDaProxima,
      content: input.content,
      source: input.source,
      sourceEvidence: input.sourceEvidence ?? null,
      createdBy: input.createdBy,
    })
    .returning();

  await recordOperationalEvent({
    source: 'system',
    type: 'brief.version_created',
    organizationId: input.organizationId,
    userId: input.createdBy,
    clientId: brief.clientId,
    entityType: 'brief',
    entityId: input.briefId,
    summary: `Criou a versão ${numeroDaProxima} do briefing.`,
  });

  return nova ?? null;
}

/**
 * P1-F — rascunho a partir da conversa. HONESTO sobre o que é: concatena o
 * texto das mensagens recebidas em `notes`, com `sourceEvidence` apontando
 * pras mensagens usadas — NUNCA preenche objective/deliverable/channel/etc.
 * por adivinhação. Uma extração estruturada de verdade (LLM lendo a
 * conversa + Brain do cliente, como o Otto skill já faz pra copy) é uma
 * entrega maior, fora do escopo desta fase — isto aqui é o andaime
 * (estrutura de versionamento, evidência, nunca inventar) sobre o qual ela
 * se encaixa depois, não uma simulação de extração que finge ser mais do
 * que é.
 */
export async function draftBriefFromDemand(input: {
  organizationId: string;
  demandId: string;
  createdBy: string;
}): Promise<{ brief: BriefRow; version: BriefVersionRow } | { error: 'demand_not_found' | 'no_conversation' }> {
  const [demanda] = await db
    .select()
    .from(schema.demands)
    .where(and(eq(schema.demands.id, input.demandId), eq(schema.demands.organizationId, input.organizationId)));
  if (!demanda) return { error: 'demand_not_found' };
  if (!demanda.conversationThreadId) return { error: 'no_conversation' };

  const mensagens = await db
    .select({ id: schema.threadMessages.id, content: schema.threadMessages.content, direction: schema.threadMessages.direction })
    .from(schema.threadMessages)
    .where(eq(schema.threadMessages.threadId, demanda.conversationThreadId));

  const recebidas = mensagens.filter((m) => m.direction === 'inbound' && m.content);
  const notes = recebidas.map((m) => m.content).join('\n');

  return createBrief({
    organizationId: input.organizationId,
    clientId: demanda.clientId,
    demandId: input.demandId,
    conversationThreadId: demanda.conversationThreadId,
    createdBy: input.createdBy,
    content: { notes: notes || undefined },
    source: 'ai_draft',
    sourceEvidence: { message_ids: recebidas.map((m) => m.id) },
  });
}

export async function getBrief(organizationId: string, briefId: string): Promise<BriefRow | null> {
  const [linha] = await db
    .select()
    .from(schema.briefs)
    .where(and(eq(schema.briefs.id, briefId), eq(schema.briefs.organizationId, organizationId)));
  return linha ?? null;
}

export async function listBriefVersions(briefId: string): Promise<BriefVersionRow[]> {
  return db.select().from(schema.briefVersions).where(eq(schema.briefVersions.briefId, briefId)).orderBy(asc(schema.briefVersions.version));
}

export async function listBriefsByDemand(organizationId: string, demandId: string): Promise<BriefRow[]> {
  return db.select().from(schema.briefs).where(and(eq(schema.briefs.organizationId, organizationId), eq(schema.briefs.demandId, demandId)));
}

/**
 * Aprova uma versão — só aceita versão do PRÓPRIO brief (nunca de outro,
 * mesmo que exista e o chamador saiba o uuid).
 */
export async function approveBriefVersion(organizationId: string, briefId: string, versionId: string): Promise<BriefRow | null> {
  const brief = await getBrief(organizationId, briefId);
  if (!brief) return null;

  const [versao] = await db
    .select({ id: schema.briefVersions.id })
    .from(schema.briefVersions)
    .where(and(eq(schema.briefVersions.id, versionId), eq(schema.briefVersions.briefId, briefId)));
  if (!versao) return null;

  const [atualizado] = await db
    .update(schema.briefs)
    .set({ approvedVersionId: versionId, status: 'approved' })
    .where(eq(schema.briefs.id, briefId))
    .returning();
  return atualizado ?? null;
}

export type SendToProductionResult =
  | { ok: true; brief: BriefRow; externalTaskId: string; externalTaskProvider: string }
  | { ok: false; reason: 'brief_not_found' }
  | { ok: false; reason: 'no_approved_version' }
  | { ok: false; reason: 'provider_error'; detail: string };

/**
 * Brief → Task (P1-G). Usa o TaskProvider já corrigido no P0 — NUNCA
 * ClickUp direto (plano de execução §P1.7, "nunca chamar ClickUp
 * diretamente").
 */
export async function sendBriefToProduction(input: {
  organizationId: string;
  briefId: string;
  dueDate?: Date | null;
}): Promise<SendToProductionResult> {
  const brief = await getBrief(input.organizationId, input.briefId);
  if (!brief) return { ok: false, reason: 'brief_not_found' };
  if (!brief.approvedVersionId) return { ok: false, reason: 'no_approved_version' };

  const [versao] = await db.select().from(schema.briefVersions).where(eq(schema.briefVersions.id, brief.approvedVersionId));
  const conteudo = (versao?.content ?? {}) as BriefContent;

  try {
    const provider = await resolveTaskProvider(input.organizationId);
    const descricao = [
      conteudo.objective && `Objetivo: ${conteudo.objective}`,
      conteudo.deliverable && `Entregável: ${conteudo.deliverable}`,
      conteudo.channel && `Canal: ${conteudo.channel}`,
      conteudo.format && `Formato: ${conteudo.format}`,
      conteudo.direction && `Direção: ${conteudo.direction}`,
      conteudo.restrictions && `Restrições: ${conteudo.restrictions}`,
      conteudo.references?.length && `Referências: ${conteudo.references.join(', ')}`,
      conteudo.notes && `Observações: ${conteudo.notes}`,
    ]
      .filter(Boolean)
      .join('\n');

    const [client] = await db.select({ clickupListId: schema.clients.clickupListId }).from(schema.clients).where(eq(schema.clients.id, brief.clientId));
    if (!client?.clickupListId) return { ok: false, reason: 'provider_error', detail: 'Cliente sem lista vinculada no provider de tarefas.' };

    // `assigneeId` do TaskProvider é o id NUMÉRICO na plataforma (ClickUp),
    // não o uuid interno do Desigual — não temos esse mapeamento resolvido
    // aqui ainda (ver bento-action-guard.ts para o padrão de resolução por
    // e-mail/username). Task nasce sem responsável automático nesta fase;
    // quem recebe atribui manualmente no board. Documentado, não um bug
    // silencioso.
    const task = await provider.createTask(
      {
        listId: client.clickupListId,
        title: `[Brief] ${conteudo.deliverable ?? 'Produção'}`,
        ...(descricao ? { description: descricao } : {}),
        ...(input.dueDate ? { dueDate: input.dueDate.getTime() } : {}),
      },
      { authorizedForProduction: true },
    );

    await db
      .update(schema.briefs)
      .set({ status: 'sent_to_production', externalTaskId: task.id, externalTaskProvider: provider.provider })
      .where(eq(schema.briefs.id, input.briefId));
    await db.update(schema.demands).set({ status: 'in_production' }).where(eq(schema.demands.id, brief.demandId));

    await recordOperationalEvent({
      source: 'system',
      type: 'task.created_from_brief',
      organizationId: input.organizationId,
      clientId: brief.clientId,
      entityType: 'brief',
      entityId: input.briefId,
      summary: 'Enviou o briefing aprovado para produção.',
      payload: { external_task_id: task.id, external_task_provider: provider.provider },
    });

    return { ok: true, brief: { ...brief, status: 'sent_to_production', externalTaskId: task.id, externalTaskProvider: provider.provider }, externalTaskId: task.id, externalTaskProvider: provider.provider };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'provider_error', detail };
  }
}
