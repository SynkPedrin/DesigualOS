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

  // Nome de exibição: o signup manda options.data.name (apps/web/src/app/
  // signup/page.tsx), que o Supabase guarda em user_metadata do token. Antes
  // isto era ignorado e o nome era sempre o prefixo do e-mail (auditoria
  // pré-deploy 14/09/2026). Fallback pro prefixo quando ausente/vazio.
  const metadata = claims.raw.user_metadata as Record<string, unknown> | undefined;
  const metadataName = typeof metadata?.name === 'string' ? metadata.name.trim() : '';

  const [created] = await db
    .insert(schema.users)
    .values({
      authUserId: claims.sub,
      email: claims.email,
      name: metadataName || (claims.email.split('@')[0] ?? claims.email),
    })
    .returning();

  if (!created) {
    throw new Error('Failed to provision user profile');
  }

  // Papel no nascimento (auditoria pré-deploy 14/09/2026): antes, TODO
  // autocadastro em /signup ganhava 'colaborador' (com clients:write,
  // clickup:write, chat:write) de graça. Agora só e-mails em masterEmails
  // ganham papel; qualquer outro fica SEM papel nenhum - sem permissões -
  // até um admin atribuir um pelo painel. O fluxo de convite (POST
  // /admin/invite) não é afetado: ele insere o usuário com papel ANTES do
  // JIT, então esta função encontra o perfil existente e sai no early return.
  if (masterEmails.has(claims.email.toLowerCase())) {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'master'));
    if (role) {
      await db.insert(schema.userRoles).values({ userId: created.id, roleId: role.id });
    }
  }

  return created;
}
