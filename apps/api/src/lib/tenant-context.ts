import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: string;
  permissions: { resource: string; action: string }[];
}

declare module 'fastify' {
  interface FastifyRequest { tenantContext?: TenantContext }
}

/** An organization selector is accepted only after checking its membership.
 * A single membership preserves the existing agency experience. Multiple
 * memberships require explicit selection; database row order is not authority. */
export async function requireTenant(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.authUser;
  if (!user) { reply.code(401).send({ error: 'Not authenticated' }); return; }
  const selected = request.headers['x-organization-id'];
  if (selected !== undefined && (typeof selected !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected))) {
    reply.code(400).send({ error: 'Invalid organization selector' }); return;
  }
  const rows = await db.select({ id: schema.organizationMembers.id, organizationId: schema.organizationMembers.organizationId, role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.userId, user.id), eq(schema.users.active, true), isNull(schema.users.deletedAt),
      selected ? eq(schema.organizationMembers.organizationId, selected) : undefined)).limit(2);
  if (rows.length !== 1) {
    reply.code(403).send({ error: rows.length ? 'Select an organization' : 'Organization membership required' }); return;
  }
  const member = rows[0]!;
  request.tenantContext = { userId: user.id, organizationId: member.organizationId, membershipId: member.id, role: member.role, permissions: user.permissions };
}

export async function clientBelongsToTenant(clientId: string, organizationId: string): Promise<boolean> {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)));
  return Boolean(client);
}
