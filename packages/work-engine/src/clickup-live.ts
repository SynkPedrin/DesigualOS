import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

const PROVIDER = 'clickup';

/**
 * Peças da sincronização AO VIVO com o ClickUp que falam só com o banco (a parte que fala com o ClickUp mora na
 * API). Tudo aqui parte do vínculo `work_external_mappings`: é ele que diz qual tarefa daqui é qual do ClickUp.
 */

/** Em qual empresa este ClickUp-lista mora aqui: pelo vínculo da lista; senão, pelo cliente que tem essa lista. */
export async function organizacaoDaListaDoClickUp(listId: string): Promise<string | null> {
  const [vinculo] = await db
    .select({ organizationId: schema.workExternalMappings.organizationId })
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'list'), eq(schema.workExternalMappings.externalId, listId)))
    .limit(1);
  if (vinculo) return vinculo.organizationId;
  const [cliente] = await db.select({ organizationId: schema.clients.organizationId }).from(schema.clients).where(eq(schema.clients.clickupListId, listId)).limit(1);
  return cliente?.organizationId ?? null;
}

/** Esta tarefa do ClickUp já existe aqui? (as subtarefas precisam do pai antes dos filhos). */
export async function tarefaDoClickUpJaImportada(organizationId: string, externalTaskId: string): Promise<boolean> {
  const [linha] = await db
    .select({ id: schema.workExternalMappings.id })
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'task'), eq(schema.workExternalMappings.externalId, externalTaskId)))
    .limit(1);
  return Boolean(linha);
}

/**
 * Tarefa apagada no ClickUp: aqui ela é ARQUIVADA, nunca apagada de verdade. O histórico, os comentários e o
 * tempo lançado dela continuam existindo, e dá para restaurar. Devolve as empresas em que alguma tarefa foi
 * arquivada (vazio = não havia o que arquivar).
 */
export async function arquivarTarefaDoClickUp(externalTaskId: string): Promise<string[]> {
  const vinculos = await db
    .select({ entityId: schema.workExternalMappings.entityId, organizationId: schema.workExternalMappings.organizationId })
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'task'), eq(schema.workExternalMappings.externalId, externalTaskId)));
  const empresas: string[] = [];
  for (const v of vinculos) {
    const r = await db
      .update(schema.workTasks)
      .set({ archivedAt: new Date(), version: sql`${schema.workTasks.version} + 1` })
      .where(and(eq(schema.workTasks.id, v.entityId), isNull(schema.workTasks.archivedAt)))
      .returning({ id: schema.workTasks.id });
    if (r.length) empresas.push(v.organizationId);
  }
  return empresas;
}
