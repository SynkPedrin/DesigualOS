import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { SupabaseClaims } from './supabase-jwt';

/**
 * O cadastro de verdade acontece no Supabase Auth (frontend chama
 * supabase-js direto, ADR 0001). Este perfil (`users`) é criado aqui, na
 * primeira vez que o token daquele usuário chega no Orchestrator (just in
 * time), não por um webhook do Supabase, pra manter tudo em um lugar só.
 */

/**
 * ACEITE DE CONVITE DE EMPRESA, no primeiro acesso autenticado.
 *
 * O convite (organization_invites, migração 0055) decidiu empresa e papel na
 * hora do envio; o que faltava era transformar "convidado" em "membro" quando
 * a pessoa de fato entra. O lugar é aqui — o JIT é a ÚNICA porta por onde todo
 * usuário autenticado passa, então nenhum aceite fica esperando uma tela.
 *
 * Três efeitos por convite pendente do e-mail:
 *
 *   1. vínculo em organization_members com o papel do convite;
 *   2. o convite marcado 'aceito' (só convite PENDENTE vira membro — revogado
 *      não ressuscita nem com o link do Supabase ainda válido);
 *   3. `organizacao_ativa_id` preenchido quando vazio, pra pessoa já entrar na
 *      empresa para a qual foi chamada em vez de cair no contexto do provedor.
 *
 * Falha aqui NÃO derruba o login: quem chama envelopa em `.catch()` — uma
 * tabela indisponível não pode impedir a pessoa de autenticar; o convite
 * continua pendente e o próximo acesso tenta de novo (idempotente).
 */
export async function aceitarConvitesPendentes(user: typeof schema.users.$inferSelect): Promise<void> {
  const pendentes = await db
    .select()
    .from(schema.organizationInvites)
    .where(and(eq(schema.organizationInvites.email, user.email.toLowerCase()), eq(schema.organizationInvites.status, 'pendente')))
    .catch(() => []);

  let primeiraEmpresaAceita: string | null = null;

  for (const convite of pendentes) {
    await db
      .insert(schema.organizationMembers)
      .values({ organizationId: convite.organizationId, userId: user.id, role: convite.role })
      .onConflictDoNothing();

    await db
      .update(schema.organizationInvites)
      .set({
        status: 'aceito',
        acceptedAt: new Date(),
        supabaseUserId: convite.supabaseUserId ?? user.authUserId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.organizationInvites.id, convite.id), eq(schema.organizationInvites.status, 'pendente')));

    await db
      .insert(schema.auditLogs)
      .values({
        userId: user.id,
        organizationId: convite.organizationId,
        action: 'convite.aceito',
        result: 'success',
        source: 'app',
        metadata: { invite_id: convite.id, email: convite.email, role: convite.role },
      })
      .catch(() => undefined);

    primeiraEmpresaAceita ??= convite.organizationId;
  }

  if (primeiraEmpresaAceita && !user.organizacaoAtivaId) {
    await db
      .update(schema.users)
      .set({ organizacaoAtivaId: primeiraEmpresaAceita })
      .where(eq(schema.users.id, user.id));
  }
}

/**
 * Domínio do e-mail técnico das pessoas que só existem no ClickUp (apps/api/src/clickup/pessoas-do-clickup.ts).
 * `.invalid` é reservado (RFC 2606): nenhum e-mail sai para esse endereço.
 */
export const DOMINIO_DE_PESSOA_DO_CLICKUP = 'clickup.desigual-os.invalid';

/**
 * A pessoa do ClickUp que chega ao sistema herda o cadastro que já existia em nome dela — com as tarefas, as
 * conversas e o vínculo com a empresa —, em vez de nascer uma segunda vez vazia. Casa pelo `clickup_email` igual ao
 * e-mail de login, e só um cadastro técnico, sem login, pode ser adotado.
 *
 * Quem chama garante que o e-mail é da pessoa: o convite (o link vai para a caixa dela) ou o token com e-mail
 * confirmado. Sem isso, cadastrar-se com o e-mail de outra pessoa daria a empresa dela de presente.
 */
export async function adotarPessoaDoClickUp(dados: { authUserId: string; email: string }): Promise<typeof schema.users.$inferSelect | null> {
  const [adotada] = await db
    .update(schema.users)
    .set({ authUserId: dados.authUserId, email: dados.email, active: true, updatedAt: new Date() })
    .where(and(
      isNull(schema.users.authUserId),
      sql`lower(${schema.users.clickupEmail}) = lower(${dados.email})`,
      sql`${schema.users.email} like ${`%@${DOMINIO_DE_PESSOA_DO_CLICKUP}`}`,
    ))
    .returning()
    .catch(() => []); // e-mail já usado por outro perfil: não adota, segue o caminho normal
  return adotada ?? null;
}

const emailConfirmado = (claims: SupabaseClaims): boolean => {
  const metadata = claims.raw.user_metadata as Record<string, unknown> | undefined;
  return metadata?.email_verified === true;
};

export async function resolveOrProvisionUser(
  claims: SupabaseClaims,
  masterEmails: ReadonlySet<string>,
): Promise<typeof schema.users.$inferSelect> {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.authUserId, claims.sub));
  if (existing) {
    await aceitarConvitesPendentes(existing).catch(() => undefined);
    return existing;
  }

  if (emailConfirmado(claims)) {
    const adotada = await adotarPessoaDoClickUp({ authUserId: claims.sub, email: claims.email });
    if (adotada) {
      await aceitarConvitesPendentes(adotada).catch(() => undefined);
      return adotada;
    }
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

  // Convite de EMPRESA pendente para este e-mail vira vínculo agora — cobre
  // tanto o perfil recém-criado (signup direto depois de convidado) quanto o
  // criado pelo generateLink do convite, que chega aqui no primeiro login.
  await aceitarConvitesPendentes(created).catch(() => undefined);

  return created;
}
