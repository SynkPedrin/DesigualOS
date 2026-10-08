import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordOperationalEvent } from '@desigual-os/orchestrator';
import { ConnectorConfigError, resolveTaskProvider } from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import type { DemandPriority, DemandSource, DemandStatus } from '@desigual-os/types';

const logger = createLogger({ service: 'demands' });

/**
 * demands/service.ts — P1-D (06/10/2026). "O cliente pediu algo" — nasce de
 * conversa OU manual (plano de execução §3, nota de paralelismo: não espera
 * o WhatsApp estar pronto).
 */

type DemandRow = typeof schema.demands.$inferSelect;

/** Responsável resolvido por `client_users.responsibility = 'account'`
 *  (P0-C) — o dono da CONTA é quem recebe a demanda por padrão. `null`
 *  quando ninguém tem essa responsabilidade definida ainda para o
 *  cliente — nunca um palpite. */
export async function resolveAccountOwner(clientId: string): Promise<string | null> {
  const [linha] = await db
    .select({ userId: schema.clientUsers.userId })
    .from(schema.clientUsers)
    .where(and(eq(schema.clientUsers.clientId, clientId), eq(schema.clientUsers.responsibility, 'account')))
    .limit(1);
  return linha?.userId ?? null;
}

export interface CreateDemandInput {
  organizationId: string;
  clientId: string;
  conversationThreadId?: string | null;
  createdBy: string;
  title: string;
  description?: string | null;
  source: DemandSource;
  priority?: DemandPriority | undefined;
  dueDate?: Date | null;
}

export async function createDemand(input: CreateDemandInput): Promise<DemandRow> {
  const ownerId = await resolveAccountOwner(input.clientId);

  const [demanda] = await db
    .insert(schema.demands)
    .values({
      organizationId: input.organizationId,
      clientId: input.clientId,
      conversationThreadId: input.conversationThreadId ?? null,
      createdBy: input.createdBy,
      ownerId,
      title: input.title,
      description: input.description ?? null,
      source: input.source,
      priority: input.priority ?? 'normal',
      dueDate: input.dueDate ?? null,
    })
    .returning();

  await recordOperationalEvent({
    source: input.source === 'whatsapp' ? 'whatsapp' : 'system',
    type: 'demand.created',
    organizationId: input.organizationId,
    userId: input.createdBy,
    clientId: input.clientId,
    entityType: 'demand',
    entityId: demanda!.id,
    summary: `Criou a campanha "${input.title}".`,
  });

  const espelho = await espelharNoClickUp(input.organizationId, input.clientId, demanda!.id, input.title, input.description ?? undefined);
  if (espelho) {
    const [atualizada] = await db
      .update(schema.demands)
      .set({ clickupTaskId: espelho.id, clickupTaskUrl: espelho.url })
      .where(eq(schema.demands.id, demanda!.id))
      .returning();
    return atualizada ?? demanda!;
  }

  return demanda!;
}

/**
 * Espelha a campanha como tarefa no provider de tarefas da empresa
 * (ClickUp/white label) — SÓ quando o cliente já tem lista vinculada.
 * NUNCA derruba a criação da campanha: sem conector, sem lista, ou erro da
 * API, a campanha nasce igual, só sem o espelho (`clickup_task_id` fica
 * null, nunca um link inventado).
 */
async function espelharNoClickUp(
  organizationId: string,
  clientId: string,
  demandId: string,
  title: string,
  description?: string,
): Promise<{ id: string; url: string | null } | null> {
  try {
    const [client] = await db.select({ clickupListId: schema.clients.clickupListId }).from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!client?.clickupListId) return null;

    const provider = await resolveTaskProvider(organizationId);
    const task = await provider.createTask(
      { listId: client.clickupListId, title, ...(description ? { description } : {}) },
      { authorizedForProduction: true },
    );

    await recordOperationalEvent({
      source: 'system',
      type: 'demand.mirrored_to_provider',
      organizationId,
      clientId,
      entityType: 'demand',
      entityId: demandId,
      summary: `Espelhou a campanha no ${provider.provider}.`,
      payload: { external_task_id: task.id, external_task_provider: provider.provider },
    });

    return task;
  } catch (error) {
    // ConnectorConfigError é esperado (conector desativado/incompleto) —
    // qualquer outro erro também não pode travar a campanha, só fica no log.
    if (!(error instanceof ConnectorConfigError)) {
      logger.warn({ error, demandId }, 'Falha ao espelhar campanha no provider de tarefas (campanha criada mesmo assim)');
    }
    return null;
  }
}

export interface ListDemandsFilter {
  organizationId: string;
  clientId?: string | undefined;
  ownerId?: string | undefined;
  status?: DemandStatus | undefined;
  limit: number;
  offset: number;
}

export async function listDemands(filter: ListDemandsFilter) {
  const condicoes = [eq(schema.demands.organizationId, filter.organizationId)];
  if (filter.clientId) condicoes.push(eq(schema.demands.clientId, filter.clientId));
  if (filter.ownerId) condicoes.push(eq(schema.demands.ownerId, filter.ownerId));
  if (filter.status) condicoes.push(eq(schema.demands.status, filter.status));

  return db
    .select({
      id: schema.demands.id,
      clientId: schema.demands.clientId,
      clientName: schema.clients.name,
      ownerId: schema.demands.ownerId,
      title: schema.demands.title,
      description: schema.demands.description,
      source: schema.demands.source,
      status: schema.demands.status,
      priority: schema.demands.priority,
      requestedAt: schema.demands.requestedAt,
      dueDate: schema.demands.dueDate,
      clickupTaskUrl: schema.demands.clickupTaskUrl,
    })
    .from(schema.demands)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.demands.clientId))
    .where(and(...condicoes))
    .orderBy(desc(schema.demands.requestedAt))
    .limit(filter.limit)
    .offset(filter.offset);
}

export async function getDemand(organizationId: string, demandId: string): Promise<DemandRow | null> {
  const [linha] = await db
    .select()
    .from(schema.demands)
    .where(and(eq(schema.demands.id, demandId), eq(schema.demands.organizationId, organizationId)));
  return linha ?? null;
}

export async function updateDemandStatus(organizationId: string, demandId: string, status: DemandStatus, changedBy: string): Promise<DemandRow | null> {
  const [atualizada] = await db
    .update(schema.demands)
    .set({ status })
    .where(and(eq(schema.demands.id, demandId), eq(schema.demands.organizationId, organizationId)))
    .returning();
  if (!atualizada) return null;

  await recordOperationalEvent({
    source: 'system',
    type: 'demand.status_changed',
    organizationId,
    userId: changedBy,
    clientId: atualizada.clientId,
    entityType: 'demand',
    entityId: demandId,
    summary: `Mudou o status da campanha para "${status}".`,
    payload: { status },
  });

  return atualizada;
}

const DEMAND_FILE_KINDS = ['briefing', 'documento', 'imagem', 'compactado', 'outro'] as const;
export type DemandFileKind = (typeof DEMAND_FILE_KINDS)[number];
export { DEMAND_FILE_KINDS };

export interface AddDemandFileInput {
  demandId: string;
  clientId: string;
  kind: DemandFileKind;
  filename: string;
  storageUrl: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  organizationId: string;
}

export async function addDemandFile(input: AddDemandFileInput) {
  const [created] = await db
    .insert(schema.demandFiles)
    .values({
      demandId: input.demandId,
      clientId: input.clientId,
      kind: input.kind,
      filename: input.filename,
      storageUrl: input.storageUrl,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: input.uploadedBy,
    })
    .returning();

  await recordOperationalEvent({
    source: 'system',
    type: 'demand.file_added',
    organizationId: input.organizationId,
    userId: input.uploadedBy,
    clientId: input.clientId,
    entityType: 'demand',
    entityId: input.demandId,
    summary: `Anexou "${input.filename}" (${input.kind}) à campanha.`,
  });

  return created!;
}

export async function listDemandFiles(demandId: string) {
  return db
    .select()
    .from(schema.demandFiles)
    .where(eq(schema.demandFiles.demandId, demandId))
    .orderBy(desc(schema.demandFiles.createdAt));
}

export async function getDemandFile(demandId: string, fileId: string) {
  const [linha] = await db
    .select()
    .from(schema.demandFiles)
    .where(and(eq(schema.demandFiles.id, fileId), eq(schema.demandFiles.demandId, demandId)));
  return linha ?? null;
}

export async function deleteDemandFileRow(fileId: string): Promise<void> {
  await db.delete(schema.demandFiles).where(eq(schema.demandFiles.id, fileId));
}
