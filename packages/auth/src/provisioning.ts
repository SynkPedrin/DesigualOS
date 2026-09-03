import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { SupabaseClaims } from './supabase-jwt';

/**
 * O cadastro de verdade acontece no Supabase Auth (frontend chama
 * supabase-js direto, ADR 0001). Este perfil (`users`) é criado aqui, na
 * primeira vez que o token daquele usuário chega no Orchestrator (just in
 * time), não por um webhook do Supabase, pra manter tudo em um lugar só.
 */
export async function resolveOrProvisionUser(
  claims: SupabaseClaims,
  masterEmails: ReadonlySet<string>,
): Promise<typeof schema.users.$inferSelect> {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.authUserId, claims.sub));
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      authUserId: claims.sub,
      email: claims.email,
      name: claims.email.split('@')[0] ?? claims.email,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to provision user profile');
  }

  const roleName = masterEmails.has(claims.email.toLowerCase()) ? 'master' : 'colaborador';
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, roleName));
  if (role) {
    await db.insert(schema.userRoles).values({ userId: created.id, roleId: role.id });
  }

  return created;
}
