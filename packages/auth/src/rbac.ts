import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { RoleName } from '@desigual-os/types';

export interface ResolvedPermission {
  resource: string;
  action: string;
}

export interface ResolvedAccess {
  roles: RoleName[];
  permissions: ResolvedPermission[];
}

/**
 * Cadeia de verificação de acesso (seção 6.8): Usuário -> Role -> Permission.
 * '*' em resource ou action é curinga (usado pelo papel master).
 */
export async function loadUserAccess(userId: string): Promise<ResolvedAccess> {
  const rows = await db
    .select({
      roleName: schema.roles.name,
      resource: schema.permissions.resource,
      action: schema.permissions.action,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .leftJoin(schema.permissions, eq(schema.permissions.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, userId));

  const roles = new Set<RoleName>();
  const permissions: ResolvedPermission[] = [];
  for (const row of rows) {
    roles.add(row.roleName);
    if (row.resource && row.action) {
      permissions.push({ resource: row.resource, action: row.action });
    }
  }

  return { roles: [...roles], permissions };
}

export function hasPermission(permissions: ResolvedPermission[], resource: string, action: string): boolean {
  return permissions.some(
    (permission) =>
      (permission.resource === '*' || permission.resource === resource) &&
      (permission.action === '*' || permission.action === action),
  );
}
