import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { invalid } from './errors';

export const DAILY_TASKS_FLAG = 'daily_tasks_enabled';

/** Papéis que respondem pela empresa. Mesma lista de `podeConfigurar` (organizations/ficha.ts). */
const ADMIN_ORG_ROLES = new Set(['owner', 'admin', 'master', 'super_admin', 'provider_owner', 'provider_admin']);

export type AccessDecision =
  | { allowed: true; reason: 'ok' }
  | { allowed: false; reason: 'flag_off' | 'not_allowlisted' | 'not_admin' };

/**
 * REGRA DE ACESSO DO BETA (Daily Tasks). As DUAS travas valem juntas e nenhuma substitui a outra:
 *   1. a flag da empresa está ligada E a pessoa está na lista de autorizadas (explícita, inclusive master);
 *   2. a pessoa é administradora (papel de plataforma `master` ou papel de empresa de quem responde por ela).
 * O front só ESCONDE o item de menu com base nisto; quem barra de verdade é o backend, em toda rota.
 */
export function decideAccess(input: { flagEnabled: boolean; allowedUserIds: string[]; userId: string; platformRoles: string[]; orgRole: string | null }): AccessDecision {
  if (!input.flagEnabled) return { allowed: false, reason: 'flag_off' };
  if (!input.allowedUserIds.includes(input.userId)) return { allowed: false, reason: 'not_allowlisted' };
  const isAdmin = input.platformRoles.includes('master') || (input.orgRole !== null && ADMIN_ORG_ROLES.has(input.orgRole.toLowerCase()));
  if (!isAdmin) return { allowed: false, reason: 'not_admin' };
  return { allowed: true, reason: 'ok' };
}

export async function getFlag(organizationId: string): Promise<{ enabled: boolean; allowedUserIds: string[] }> {
  const [row] = await db
    .select({ enabled: schema.workFeatureFlags.enabled, allowedUserIds: schema.workFeatureFlags.allowedUserIds })
    .from(schema.workFeatureFlags)
    .where(and(eq(schema.workFeatureFlags.organizationId, organizationId), eq(schema.workFeatureFlags.key, DAILY_TASKS_FLAG)));
  return { enabled: row?.enabled ?? false, allowedUserIds: row?.allowedUserIds ?? [] };
}

export async function resolveDailyTasksAccess(input: { organizationId: string; userId: string; platformRoles: string[] }): Promise<AccessDecision> {
  const [flag, member] = await Promise.all([
    getFlag(input.organizationId),
    db
      .select({ role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.organizationId, input.organizationId), eq(schema.organizationMembers.userId, input.userId)))
      .then((r) => r[0] ?? null),
  ]);
  return decideAccess({ flagEnabled: flag.enabled, allowedUserIds: flag.allowedUserIds, userId: input.userId, platformRoles: input.platformRoles, orgRole: member?.role ?? null });
}

/** Liga/desliga e define quem entra. Só o ADMINISTRADOR DE PLATAFORMA (`master`) chama isto, pela rota de admin. */
export async function setFlag(input: { organizationId: string; enabled: boolean; allowedUserIds: string[]; updatedBy: string }): Promise<void> {
  const unique = [...new Set(input.allowedUserIds)];
  if (unique.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw invalid('Lista de usuários autorizados contém um id inválido.');
  if (unique.length > 0) {
    const members = await db
      .select({ userId: schema.organizationMembers.userId })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, input.organizationId));
    const valid = new Set(members.map((m) => m.userId));
    const stranger = unique.find((id) => !valid.has(id));
    if (stranger) throw invalid('Só membros da empresa podem ser autorizados.', { userId: stranger });
  }
  await db
    .insert(schema.workFeatureFlags)
    .values({ organizationId: input.organizationId, key: DAILY_TASKS_FLAG, enabled: input.enabled, allowedUserIds: unique, updatedBy: input.updatedBy })
    .onConflictDoUpdate({
      target: [schema.workFeatureFlags.organizationId, schema.workFeatureFlags.key],
      set: { enabled: input.enabled, allowedUserIds: unique, updatedBy: input.updatedBy, updatedAt: new Date() },
    });
}
