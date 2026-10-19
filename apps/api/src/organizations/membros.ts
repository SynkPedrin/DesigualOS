import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import type { AuthenticatedUser } from '../auth/middleware';
import { auditarAcao } from '../lib/auditoria';
import { enviarConviteDeOrganizacao } from '../lib/convite';
import { sendAddedToOrganizationEmail } from '../lib/email';
import { podeConfigurar, type PermissaoDeConfigurar } from './ficha';

/**
 * membros.ts — QUEM TRABALHA NA EMPRESA: membros e convites.
 *
 * O convite de PLATAFORMA (POST /admin/invite) nasceu sem vínculo com empresa,
 * sem papel de organização e sem registro local. Estas rotas são a versão de
 * EMPRESA: todo convite vira uma linha em `organization_invites` (listável,
 * revogável, auditável) e todo aceite vira uma linha em `organization_members`
 * com o papel decidido no convite.
 *
 * A PORTA É UMA SÓ, a mesma da ficha e dos conectores (`podeConfigurar`): o
 * provedor, ou quem responde pela empresa (owner/admin do vínculo). Um
 * colaborador vê a empresa inteira e não mexe em quem trabalha nela — usar a
 * conta e ser responsável por ela são coisas diferentes.
 *
 * EMPRESA ALHEIA RESPONDE 404, nunca 403: "existe mas não é sua" confirma a
 * existência da empresa para quem não deveria saber que ela existe — mesmo
 * critério da ficha e da troca de contexto.
 *
 * NENHUM TOKEN PRÓPRIO: o link mágico é do Supabase Auth (já hash, expira e é
 * one-time por lá). A linha local existe para listar, revogar e auditar — não
 * para carregar segredo.
 */

/** Papéis de empresa que um convite ou uma troca de papel aceita. */
const PAPEL_DE_EMPRESA = z.enum(['owner', 'admin', 'collaborator']);

/**
 * "DONO" para as guardas é `owner` exato (a convenção que criarEmpresa grava).
 * Os sinônimos de admin (master/super_admin, ver PAPEIS_QUE_RESPONDEM na ficha)
 * NÃO contam como dono aqui de propósito: a guarda existe para impedir que a
 * empresa fique sem responsável, e um 'SUPER_ADMIN' legado não deve segurar
 * sozinho esse papel.
 */
function ehDono(papel: string): boolean {
  return papel.toLowerCase() === 'owner';
}

const conviteSchema = z.object({
  email: z.string().trim().email().max(200),
  role: PAPEL_DE_EMPRESA,
});

const trocaDePapelSchema = z.object({ role: PAPEL_DE_EMPRESA });

interface AcessoAEmpresa {
  orgId: string;
  orgNome: string;
  permissao: PermissaoDeConfigurar;
}

export async function registerOrganizationMemberRoutes(app: FastifyInstance): Promise<void> {
  /**
   * A portaria compartilhada dos seis verbos: autenticado, a empresa existe,
   * e quem chama pode configurá-la. "Não existe" e "não é sua" respondem o
   * mesmo 404 (ver cabeçalho).
   */
  async function portaria(
    request: { authUser?: AuthenticatedUser; params: unknown },
  ): Promise<AcessoAEmpresa | { erro: { status: number; body: { error: string } } }> {
    const user = request.authUser;
    if (!user) return { erro: { status: 401, body: { error: 'Not authenticated' } } };

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    // A empresa precisa existir MESMO para o provedor — `podeConfigurar` não
    // olha a tabela de empresas para quem é provider, e um convite para uma
    // empresa inexistente seria FK violada no insert, ilegível.
    const [org] = await db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .catch(() => []);
    if (!org) return { erro: { status: 404, body: { error: 'Empresa não encontrada.' } } };

    const permissao = await podeConfigurar(user, id);
    if (!permissao.pode) {
      return {
        erro: {
          status: permissao.motivo === 'Empresa não encontrada.' ? 404 : 403,
          body: { error: permissao.motivo ?? 'Sem permissão.' },
        },
      };
    }

    return { orgId: id, orgNome: org.name, permissao };
  }

  /** O vínculo de uma pessoa numa empresa, quando existe. */
  async function vinculoDe(orgId: string, userId: string) {
    const [vinculo] = await db
      .select({ id: schema.organizationMembers.id, role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.organizationId, orgId), eq(schema.organizationMembers.userId, userId)))
      .catch(() => []);
    return vinculo ?? null;
  }

  /** Quantos DONOS a empresa tem. Base da guarda do único owner. */
  async function contarDonos(orgId: string): Promise<number> {
    const membros = await db
      .select({ role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, orgId))
      .catch(() => []);
    return membros.filter((m) => ehDono(m.role)).length;
  }

  /**
   * CONVIDAR (ou adicionar direto) alguém para a empresa.
   *
   * DOIS CAMINHOS, decididos por o e-mail já ter conta:
   *
   *   - JÁ TEM CONTA: não há o que convidar — não há senha para definir nem
   *     link mágico que faça sentido. Cria o vínculo na hora, grava o convite
   *     como 'aceito' (é o rastro de quem colocou a pessoa, quando e com que
   *     papel) e manda só um aviso por e-mail, quando o Resend está
   *     configurado;
   *   - NÃO TEM CONTA: fluxo Supabase generateLink + Resend (ou o e-mail
   *     padrão do Supabase sem Resend), e o convite fica 'pendente' até o
   *     aceite no primeiro login (JIT em packages/auth/provisioning.ts).
   *
   * E-MAIL NORMALIZADO EM MINÚSCULO na gravação e na comparação: `users.email`
   * é text (sem citext), então a consistência é da aplicação.
   */
  app.post('/organizations/:id/invites', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }
    const user = request.authUser as AuthenticatedUser;
    const body = conviteSchema.parse(request.body);
    const email = body.email.toLowerCase();

    const [pessoa] = await db
      .select({ id: schema.users.id, authUserId: schema.users.authUserId, name: schema.users.name })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`)
      .catch(() => []);

    if (pessoa) {
      const existente = await vinculoDe(acesso.orgId, pessoa.id);
      if (existente) {
        reply.code(409);
        return { error: 'Essa pessoa já é membro desta empresa.' };
      }

      await db.insert(schema.organizationMembers).values({ organizationId: acesso.orgId, userId: pessoa.id, role: body.role });

      const [convite] = await db
        .insert(schema.organizationInvites)
        .values({
          organizationId: acesso.orgId,
          email,
          role: body.role,
          status: 'aceito',
          invitedByUserId: user.id,
          supabaseUserId: pessoa.authUserId,
          acceptedAt: new Date(),
        })
        .returning();

      // O aviso é best-effort: quem já tem conta não depende do e-mail para
      // entrar — a empresa simplesmente aparece para ela no próximo acesso.
      let emailEnviado = false;
      let motivo: string | null = 'Resend não configurado; o aviso não é necessário para a pessoa entrar.';
      try {
        await sendAddedToOrganizationEmail({ to: email, name: pessoa.name, organizationName: acesso.orgNome });
        emailEnviado = true;
        motivo = null;
      } catch {
        // segue com emailEnviado=false
      }

      await auditarAcao(request, {
        action: 'member.added',
        organizationId: acesso.orgId,
        metadata: { email, role: body.role, target_user_id: pessoa.id, origem: 'convite_direto' },
        comoProvedor: acesso.permissao.comoProvedor,
      });

      reply.code(201);
      return { id: convite?.id ?? null, email, papel: body.role, status: 'aceito', membro_criado: true, email_enviado: emailEnviado, motivo, link: null };
    }

    const [pendente] = await db
      .select({ id: schema.organizationInvites.id })
      .from(schema.organizationInvites)
      .where(
        and(
          eq(schema.organizationInvites.organizationId, acesso.orgId),
          eq(schema.organizationInvites.email, email),
          eq(schema.organizationInvites.status, 'pendente'),
        ),
      )
      .catch(() => []);
    if (pendente) {
      reply.code(409);
      return { error: 'Já existe um convite pendente para este e-mail nesta empresa. Reenvie ou revogue o atual.' };
    }

    const envio = await enviarConviteDeOrganizacao({ email, papel: body.role, nomeDaEmpresa: acesso.orgNome });

    let convite;
    try {
      [convite] = await db
        .insert(schema.organizationInvites)
        .values({
          organizationId: acesso.orgId,
          email,
          role: body.role,
          status: 'pendente',
          invitedByUserId: user.id,
          supabaseUserId: envio.supabaseUserId,
        })
        .returning();
    } catch (erro) {
      // O índice parcial (org, email) WHERE status='pendente' é a rede de
      // segurança contra duas requisições simultâneas: a segunda perde aqui,
      // com a mesma resposta do check acima.
      if (erro instanceof Error && erro.message.includes('unique')) {
        reply.code(409);
        return { error: 'Já existe um convite pendente para este e-mail nesta empresa. Reenvie ou revogue o atual.' };
      }
      throw erro;
    }

    await auditarAcao(request, {
      action: 'convite.criado',
      organizationId: acesso.orgId,
      metadata: { email, role: body.role, email_enviado: envio.emailEnviado },
      comoProvedor: acesso.permissao.comoProvedor,
    });

    reply.code(201);
    return {
      id: convite?.id ?? null,
      email,
      papel: body.role,
      status: 'pendente',
      membro_criado: false,
      email_enviado: envio.emailEnviado,
      motivo: envio.motivo,
      link: envio.link,
    };
  });

  /**
   * OS MEMBROS E OS CONVITES PENDENTES da empresa. `ultimo_acesso` vem de
   * `users.last_seen_at` (presença tocada pelo requireAuth, no máximo 1x/min)
   * — não existe coluna de último login, e inventar uma seria pior que omitir;
   * `null` = nunca visto.
   */
  app.get('/organizations/:id/members', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    const [membros, convites] = await Promise.all([
      db
        .select({
          id: schema.users.id,
          nome: schema.users.name,
          email: schema.users.email,
          papel: schema.organizationMembers.role,
          ativa: schema.users.active,
          ultimo_acesso: schema.users.lastSeenAt,
          membro_desde: schema.organizationMembers.createdAt,
        })
        .from(schema.organizationMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
        .where(eq(schema.organizationMembers.organizationId, acesso.orgId))
        .catch(() => []),
      db
        .select({
          id: schema.organizationInvites.id,
          email: schema.organizationInvites.email,
          papel: schema.organizationInvites.role,
          status: schema.organizationInvites.status,
          convidado_em: schema.organizationInvites.createdAt,
        })
        .from(schema.organizationInvites)
        .where(and(eq(schema.organizationInvites.organizationId, acesso.orgId), eq(schema.organizationInvites.status, 'pendente')))
        .catch(() => []),
    ]);

    return {
      membros: membros.map((m) => ({
        ...m,
        ultimo_acesso: m.ultimo_acesso ? new Date(m.ultimo_acesso).toISOString() : null,
        membro_desde: m.membro_desde ? new Date(m.membro_desde).toISOString() : null,
      })),
      convites_pendentes: convites.map((c) => ({
        ...c,
        convidado_em: c.convidado_em ? new Date(c.convidado_em).toISOString() : null,
      })),
    };
  });

  /**
   * TROCAR O PAPEL de um membro. Guardas:
   *
   *   - o ÚNICO dono não pode ser rebaixado — uma empresa sem responsável é
   *     uma conta que ninguém mais consegue administrar;
   *   - um ADMIN não rebaixa um DONO (só dono mexe em dono); o provedor pode
   *     tudo, menos deixar a empresa sem dono.
   */
  app.patch('/organizations/:id/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }
    const user = request.authUser as AuthenticatedUser;
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = trocaDePapelSchema.parse(request.body);

    const alvo = await vinculoDe(acesso.orgId, userId);
    if (!alvo) {
      reply.code(404);
      return { error: 'Membro não encontrado nesta empresa.' };
    }

    if (ehDono(alvo.role) && !ehDono(body.role)) {
      if (!acesso.permissao.comoProvedor) {
        const meu = await vinculoDe(acesso.orgId, user.id);
        if (!meu || !ehDono(meu.role)) {
          reply.code(403);
          return { error: 'Só um dono pode mudar o papel de outro dono.' };
        }
      }
      if ((await contarDonos(acesso.orgId)) <= 1) {
        reply.code(409);
        return { error: 'A empresa precisa de pelo menos um dono. Promova outro membro a dono antes.' };
      }
    }

    await db
      .update(schema.organizationMembers)
      .set({ role: body.role, updatedAt: new Date() })
      .where(eq(schema.organizationMembers.id, alvo.id));

    await auditarAcao(request, {
      action: 'member.role_changed',
      organizationId: acesso.orgId,
      metadata: { target_user_id: userId, de: alvo.role, para: body.role },
      comoProvedor: acesso.permissao.comoProvedor,
    });

    return { id: userId, papel: body.role };
  });

  /**
   * REMOVER da empresa — o vínculo, nunca o usuário: a conta, o histórico e o
   * rastro de auditoria da pessoa continuam existindo. Se a pessoa estava
   * TRABALHANDO nesta empresa (organizacao_ativa_id), o contexto é limpo —
   * senão o vínculo removido continuaria resolvendo até a próxima validação.
   */
  app.delete('/organizations/:id/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }
    const user = request.authUser as AuthenticatedUser;
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);

    const alvo = await vinculoDe(acesso.orgId, userId);
    if (!alvo) {
      reply.code(404);
      return { error: 'Membro não encontrado nesta empresa.' };
    }

    if (ehDono(alvo.role)) {
      if (!acesso.permissao.comoProvedor) {
        const meu = await vinculoDe(acesso.orgId, user.id);
        if (!meu || !ehDono(meu.role)) {
          reply.code(403);
          return { error: 'Só um dono pode remover outro dono.' };
        }
      }
      if ((await contarDonos(acesso.orgId)) <= 1) {
        reply.code(409);
        return { error: 'A empresa precisa de pelo menos um dono. Promova outro membro a dono antes.' };
      }
    }

    await db.delete(schema.organizationMembers).where(eq(schema.organizationMembers.id, alvo.id));
    await db
      .update(schema.users)
      .set({ organizacaoAtivaId: null })
      .where(and(eq(schema.users.id, userId), eq(schema.users.organizacaoAtivaId, acesso.orgId)));

    await auditarAcao(request, {
      action: 'member.removed',
      organizationId: acesso.orgId,
      metadata: { target_user_id: userId, role: alvo.role },
      comoProvedor: acesso.permissao.comoProvedor,
    });

    return { id: userId, removido: true };
  });

  /**
   * REENVIAR um convite pendente. Gera um link NOVO no Supabase (o antigo
   * pode ter expirado) e repete o envio — nunca finge: se o e-mail não sair,
   * a resposta diz `email_enviado: false` com o motivo e o link para envio
   * manual.
   */
  app.post('/organizations/:id/invites/:inviteId/reenviar', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }
    const { inviteId } = z.object({ inviteId: z.string().uuid() }).parse(request.params);

    const [convite] = await db
      .select()
      .from(schema.organizationInvites)
      .where(and(eq(schema.organizationInvites.id, inviteId), eq(schema.organizationInvites.organizationId, acesso.orgId)))
      .catch(() => []);
    if (!convite) {
      reply.code(404);
      return { error: 'Convite não encontrado nesta empresa.' };
    }
    if (convite.status !== 'pendente') {
      reply.code(409);
      return { error: `Só se reenvia convite pendente; este está ${convite.status}.` };
    }

    const envio = await enviarConviteDeOrganizacao({ email: convite.email, papel: convite.role, nomeDaEmpresa: acesso.orgNome });

    if (envio.supabaseUserId && envio.supabaseUserId !== convite.supabaseUserId) {
      await db
        .update(schema.organizationInvites)
        .set({ supabaseUserId: envio.supabaseUserId, updatedAt: new Date() })
        .where(eq(schema.organizationInvites.id, convite.id));
    }

    await auditarAcao(request, {
      action: 'convite.reenviado',
      organizationId: acesso.orgId,
      metadata: { invite_id: convite.id, email: convite.email, email_enviado: envio.emailEnviado },
      comoProvedor: acesso.permissao.comoProvedor,
    });

    return { id: convite.id, email: convite.email, email_enviado: envio.emailEnviado, motivo: envio.motivo, link: envio.link };
  });

  /**
   * REVOGAR um convite pendente. A linha não é apagada: vira 'revogado' e fica
   * como rastro de quem convidou e quando. (O link do Supabase pode
   * tecnicamente continuar válido até expirar, mas o aceite no JIT só cria
   * vínculo para convite pendente — revogado não vira membro.)
   */
  app.delete('/organizations/:id/invites/:inviteId', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }
    const { inviteId } = z.object({ inviteId: z.string().uuid() }).parse(request.params);

    const [convite] = await db
      .select({ id: schema.organizationInvites.id, status: schema.organizationInvites.status, email: schema.organizationInvites.email })
      .from(schema.organizationInvites)
      .where(and(eq(schema.organizationInvites.id, inviteId), eq(schema.organizationInvites.organizationId, acesso.orgId)))
      .catch(() => []);
    if (!convite) {
      reply.code(404);
      return { error: 'Convite não encontrado nesta empresa.' };
    }
    if (convite.status !== 'pendente') {
      reply.code(409);
      return { error: `Só se revoga convite pendente; este está ${convite.status}.` };
    }

    await db
      .update(schema.organizationInvites)
      .set({ status: 'revogado', revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.organizationInvites.id, convite.id));

    await auditarAcao(request, {
      action: 'convite.revogado',
      organizationId: acesso.orgId,
      metadata: { invite_id: convite.id, email: convite.email },
      comoProvedor: acesso.permissao.comoProvedor,
    });

    return { id: convite.id, status: 'revogado' };
  });
}
