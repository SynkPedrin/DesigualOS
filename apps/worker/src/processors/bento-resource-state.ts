import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { emptyResourceState, type ConversationResourceState, type SelectedResourceRef } from '@desigual-os/bento-core';

/**
 * Persistência do ConversationResourceState (§3 da missão de release
 * OpenAI + ClickUp MCP — "BENTO CORE CUTOVER"). Usa a tabela
 * `conversation_context` (schema existente, `contextType`/`payload` jsonb,
 * nunca usada por nenhum código até esta missão) em vez de criar
 * migration nova: cada turno grava um snapshot novo (append-only, mesmo
 * padrão de `execution-record.ts`/`selection.ts`), lê-se sempre a linha
 * mais recente.
 */
const CONTEXT_TYPE = 'bento_resource_state';

function isSelectedResourceRef(value: unknown): value is SelectedResourceRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SelectedResourceRef>;
  return v.resourceType === 'CLICKUP_TASK' && typeof v.resourceId === 'string';
}

/** Parse defensivo: payload é jsonb livre, qualquer desvio do formato esperado cai pro estado vazio. */
export function parseResourceState(raw: unknown): ConversationResourceState {
  const empty = emptyResourceState();
  if (typeof raw !== 'object' || raw === null) return empty;
  const r = raw as Partial<ConversationResourceState>;
  return {
    version: 1,
    focusedResource: isSelectedResourceRef(r.focusedResource) ? r.focusedResource : null,
    selectedResources: Array.isArray(r.selectedResources) ? r.selectedResources.filter(isSelectedResourceRef) : [],
    recentCreatedResources: Array.isArray(r.recentCreatedResources) ? r.recentCreatedResources.filter(isSelectedResourceRef) : [],
    recentUpdatedResources: Array.isArray(r.recentUpdatedResources) ? r.recentUpdatedResources.filter(isSelectedResourceRef) : [],
    lastExecution:
      typeof r.lastExecution === 'object' && r.lastExecution !== null && typeof (r.lastExecution as { operation?: unknown }).operation === 'string'
        ? (r.lastExecution as ConversationResourceState['lastExecution'])
        : null,
    client: typeof r.client === 'object' && r.client !== null && typeof (r.client as { id?: unknown }).id === 'string' ? (r.client as ConversationResourceState['client']) : null,
    assignee:
      typeof r.assignee === 'object' && r.assignee !== null && typeof (r.assignee as { name?: unknown }).name === 'string'
        ? (r.assignee as ConversationResourceState['assignee'])
        : null,
    dueDate: typeof r.dueDate === 'string' ? r.dueDate : null,
    sources: Array.isArray(r.sources) ? r.sources.filter((s): s is string => typeof s === 'string') : [],
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : empty.updatedAt,
  };
}

export async function loadResourceState(conversationId: string): Promise<ConversationResourceState> {
  const [row] = await db
    .select({ payload: schema.conversationContext.payload })
    .from(schema.conversationContext)
    .where(eq(schema.conversationContext.conversationId, conversationId))
    .orderBy(desc(schema.conversationContext.createdAt))
    .limit(1)
    .catch(() => []);
  return row ? parseResourceState(row.payload) : emptyResourceState();
}

export async function persistResourceState(conversationId: string, state: ConversationResourceState): Promise<void> {
  await db.insert(schema.conversationContext).values({
    conversationId,
    contextType: CONTEXT_TYPE,
    payload: { ...state, updatedAt: new Date().toISOString() } as Record<string, unknown>,
  });
}

/** Atualiza o estado após um write bem-sucedido — chamado uma vez por operação verificada. */
export function applyExecutionToState(
  state: ConversationResourceState,
  update: { operation: string; resourceIds: string[]; verified: boolean; created: boolean; title?: string | null },
): ConversationResourceState {
  const refs: SelectedResourceRef[] = update.resourceIds.map((resourceId) => ({
    resourceType: 'CLICKUP_TASK',
    resourceId,
    title: update.title ?? null,
  }));
  return {
    ...state,
    focusedResource: refs[0] ?? state.focusedResource,
    recentCreatedResources: update.created ? [...refs, ...state.recentCreatedResources].slice(0, 20) : state.recentCreatedResources,
    recentUpdatedResources: !update.created ? [...refs, ...state.recentUpdatedResources].slice(0, 20) : state.recentUpdatedResources,
    lastExecution: { operation: update.operation, resourceIds: update.resourceIds, verified: update.verified, at: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
}
