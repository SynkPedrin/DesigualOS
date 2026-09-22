import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { hasPermission, loadUserAccess } from '@desigual-os/auth';
import type { SeniorToolContext } from '@desigual-os/tool-gateway';

/** Resolve authority exclusively from persisted execution and current access. */
export async function loadSeniorRuntimeContext(executionDbId: string): Promise<SeniorToolContext | null> {
  const [execution] = await db.select().from(schema.executions).where(eq(schema.executions.id, executionDbId));
  if (!execution || (execution.agent !== 'bento' && execution.agent !== 'otto')) return null;
  const [actor] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, execution.userId), eq(schema.users.active, true), isNull(schema.users.deletedAt),
  ));
  if (!actor) return null;
  const memberships = await db.select().from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, actor.id));
  let organizationId: string | null = null;
  if (execution.clientId) {
    const [client] = await db.select().from(schema.clients).where(and(
      eq(schema.clients.id, execution.clientId), isNull(schema.clients.deletedAt),
    ));
    organizationId = client?.organizationId ?? null;
  } else if (memberships.length === 1) {
    organizationId = memberships[0]!.organizationId;
  }
  if (!organizationId || !memberships.some(m => m.organizationId === organizationId)) return null;
  const access = await loadUserAccess(actor.id);
  return {
    executionId: execution.executionId, userId: actor.id, organizationId, agent: execution.agent,
    permissions: hasPermission(access.permissions, 'clickup', 'write') ? [{ resource: 'clickup', action: 'write' }] : [],
  };
}
