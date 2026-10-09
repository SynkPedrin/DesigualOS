import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { getSupabaseAdminClient } from '@desigual-os/auth';
import { ROLE_NAMES } from '@desigual-os/types';
import { invalidateUserAccessCache, requireAuth, requirePermission, requireRole } from '../auth/middleware';
import { recorteDePessoasVisiveis } from '../lib/escopo-de-organizacao';
import { requireTenant, userBelongsToTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import { conferirEntrega, entregaFalhou, sendInviteEmail } from '../lib/email';
import { urlPublicaDoAppCom } from '../lib/url-do-app';

/**
 * Garante que o ALVO de uma mutação pertence à empresa em que o CHAMADOR está
 * trabalhando agora - nunca a qualquer empresa que ele apenas enxerga.
 *
 * Antes desta checagem, `users:write` sozinho bastava para as 4 rotas abaixo:
 * um master da empresa A podia mudar papel, desativar, renomear ou apagar um
 * usuário cujo único vínculo era a empresa B, bastando saber o uuid - a
 * permissão responde "esta pessoa pode administrar gente?", nunca "gente de
 * qual empresa?" (a listagem, `GET /admin/users`, já aplicava essa segunda
 * pergunta via `recorteDePessoasVisiveis`; só as mutações vazavam).
 *
 * Resolve a organização de trabalho pela MESMA escada de `requireTenant`
 * (cabeçalho -> empresa ativa -> vínculo único -> provedora - nunca um id
 * vindo do navegador sem validar) e confirma que o alvo é membro DELA. Um
 * provedor só escreve numa subconta depois de entrar nela de propósito
 * (POST /organizations/ativa) - é a regra "leitura desce, escrita nunca
 * atravessa" de packages/auth/src/hierarquia-de-organizacao.ts, aplicada aqui
 * a PESSOA em vez de a um recurso com `organization_id` próprio.
 *
 * 404 (não 403) quando não pertence: mesmo padrão de `podeConfigurar`
 * (organizations/ficha.ts) e `clientBelongsToTenant` - dizer "não é seu"
 * confirmaria a existência de um usuário de outro tenant para quem não
 * deveria saber disso.
 */
async function exigirAlvoNaOrganizacaoDeTrabalho(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUserId: string,
): Promise<boolean> {
  await requireTenant(request, reply);
  if (reply.sent) return false;

  if (!(await userBelongsToTenant(targetUserId, request.tenantContext!.organizationId))) {
    reply.code(404).send({ error: `User '${targetUserId}' not found` });
    // P0-14 (06/10/2026): tentativa de mutação cross-tenant numa rota
    // destrutiva/privilegiada — exatamente o caso que vale registrar (não é
    // 403 rotineiro de permissão ausente, é alvo de OUTRA empresa). Nunca
    // bloqueia a resposta (já foi enviada); falha de auditoria não é falha
    // de autorização.
    await auditarAcao(request, {
      action: 'authorization.denied',
      result: 'denied',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: { reason: 'cross_tenant_target', route: request.url },
    });
    return false;
  }
  return true;
}

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(ROLE_NAMES),
});

const changeRoleSchema = z.object({ role: z.enum(ROLE_NAMES) });
const changeStatusSchema = z.object({ active: z.boolean() });
const updateUserSchema = z.object({ name: z.string().min(1) });

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Convite de colaborador (pedido do usuário): admin master convida por
   * e-mail, o Supabase Auth manda o e-mail de verdade com um link mágico
   * pra esse e-mail. Diferente do provisionamento just-in-time da Fase 13
   * (usado quando alguém aparece sem convite prévio): aqui o papel já é
   * decidido pelo admin no convite, não inferido de MASTER_USER_EMAILS.
   *
   * SÓ ADMINISTRADOR CRIA CONTA (07/10/2026, pedido do usuário). Duas portas,
   * de propósito: `users:write` é o contrato de RBAC, e `requireRole('master')`
   * é identidade. A permissão mora em LINHAS da tabela `permissions` — um seed
   * antigo ou uma correção apressada num ambiente bastaria para o papel
   * colaborador ganhar `users:write` e, com ele, o direito de fabricar acesso
   * novo ao sistema inteiro. O papel não se configura por linha de tabela.
   *
   * E O CONVIDADO NASCE DENTRO DE UMA EMPRESA. Antes esta rota criava o perfil
   * e o papel de plataforma e parava aí: ninguém escrevia em
   * `organization_members`. O resultado, medido na prática, é um usuário que
   * entra, autentica e encontra um sistema VAZIO — `escopoDeOrganizacao`
   * devolve `organizationIds: []`, e todo recorte de tenant (clientes, equipe,
   * conhecimento, demandas) filtra tudo para fora. Parecia conta quebrada;
   * era conta sem empresa. O vínculo sai na MESMA empresa de trabalho de quem
   * convidou (a escada de `requireTenant`, nunca um id vindo do navegador):
   * escrita não atravessa fronteira de empresa — nem para criar gente.
   */
  app.post(
    '/admin/invite',
    { preHandler: [requireAuth, requirePermission('users', 'write'), requireRole('master')] },
    async (request, reply) => {
    const body = inviteSchema.parse(request.body);

    await requireTenant(request, reply);
    if (reply.sent) return;
    const organizationId = request.tenantContext!.organizationId;

    const supabaseUrl = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !secretKey) {
      reply.code(500);
      return { error: 'SUPABASE_URL/SUPABASE_SECRET_KEY not configured on the Orchestrator' };
    }

    const admin = getSupabaseAdminClient(supabaseUrl, secretKey);
    const redirectTo = urlPublicaDoAppCom('/convite');

    // Com Resend configurado, geramos o link de convite pelo Supabase (sem
    // deixar ele mandar o e-mail padrão dele) e mandamos nosso próprio
    // e-mail com a marca da Desigual (logo + fundo, pedido do usuário).
    // Sem Resend, cai pro e-mail padrão do Supabase (funcional, sem marca).
    const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
    let authUserId: string;
    /**
     * A conta já existia antes deste convite? Decide a resposta no fim e o que
     * a tela diz. Vive aqui, não dentro do ramo do Resend, porque os dois
     * caminhos de convite precisam poder respondê-la.
     */
    let jaTinhaConta = false;

    if (hasResend) {
      /**
       * O `try` existe porque `generateLink` não falha só devolvendo `error`:
       * rede fora, DNS, 5xx do Supabase e corpo inesperado LANÇAM. Sem isto, o
       * throw subia até o handler global e o convite virava "Internal Server
       * Error" na tela — mensagem que não diz o que fazer e que mandou o
       * usuário procurar no log de um processo que ele não tem aberto
       * (08/10/2026). O que quebra em integração externa é a integração
       * externa: a tela tem que poder dizer isso.
       */
      let data: Awaited<ReturnType<typeof admin.auth.admin.generateLink>>['data'];
      try {
        const resposta = await admin.auth.admin.generateLink({
          type: 'invite',
          email: body.email,
          options: { data: { invited_role: body.role, invited_name: body.name ?? null }, redirectTo },
        });

        /**
         * RECONVIDAR ALGUÉM QUE JÁ TEM CONTA É O CASO NORMAL, NÃO O ERRO.
         *
         * O Supabase recusa `type: 'invite'` para e-mail já registrado:
         * "A user with this email address has already been registered". O
         * código antigo não tratava isso de forma nenhuma e devolvia 500
         * "Internal Server Error" — a mensagem que o Pedro viu na tela ao
         * tentar convidar uma pessoa que já estava no sistema (08/10/2026).
         *
         * Recusar é a resposta errada, e por um motivo que o próprio bloco
         * mais abaixo já reconhece: "Reconvidar alguém que ficou sem papel (ou
         * sem empresa) é exatamente o caso em que se reconvida". Há gente no
         * banco nesse estado AGORA — conta ativa, zero papéis, nenhum vínculo
         * — que entra no sistema e toma 403 em toda tela. Um 400 dizendo
         * "já registrado" tranca a única porta que consertaria isso.
         *
         * Então, quando a conta existe, o convite vira RECUPERAÇÃO: um link
         * para a pessoa definir a senha, e o resto do fluxo (papel + vínculo
         * com a empresa) segue igual. O efeito é o que o administrador quis
         * dizer ao clicar em "Enviar convite": essa pessoa deve ter acesso.
         */
        const jaRegistrado = /already been registered|already exists/i.test(resposta.error?.message ?? '');
        if (jaRegistrado) {
          jaTinhaConta = true;
          const recuperacao = await admin.auth.admin.generateLink({
            type: 'recovery',
            email: body.email,
            options: { redirectTo },
          });
          if (recuperacao.error || !recuperacao.data.user) {
            reply.code(400);
            return {
              error:
                `${body.email} já tem conta, mas não consegui gerar o link para ela definir a senha` +
                `${recuperacao.error?.message ? `: ${recuperacao.error.message}` : '.'}`,
            };
          }
          data = recuperacao.data;
        } else if (resposta.error || !resposta.data.user) {
          reply.code(400);
          return { error: resposta.error?.message ?? 'Failed to generate invite link' };
        } else {
          data = resposta.data;
        }
      } catch (erro) {
        request.log.error({ erro, email: body.email }, 'generateLink do Supabase falhou');
        reply.code(502);
        return {
          error: `Não consegui falar com o Supabase para gerar o convite: ${erro instanceof Error ? erro.message : String(erro)}`,
        };
      }
      authUserId = data.user!.id;

      try {
        const envioId = await sendInviteEmail({
          to: body.email,
          name: body.name ?? null,
          role: body.role,
          inviteLink: data.properties!.action_link,
        });
        /**
         * 200 do provedor não é entrega. Se o endereço já voltou alguma vez,
         * o Resend o mantém numa lista de supressão e DESCARTA os envios
         * seguintes — respondendo 200, com id, como se tivesse mandado.
         * Sem esta conferência a tela dizia "convite enviado" para uma
         * mensagem que o provedor jogou fora (medido em 08/10/2026).
         *
         * Checagem de melhor esforço: `suppressed` o provedor já sabe na
         * hora, `bounced` costuma demorar mais do que uma requisição HTTP
         * pode esperar. Não achar nada devolve `null` e o convite segue — o
         * usuário no Auth já existe neste ponto, e falha de rede na
         * conferência não pode transformar um convite válido em erro.
         */
        if (envioId) {
          const evento = await conferirEntrega(envioId);
          if (entregaFalhou(evento)) {
            reply.code(502);
            return {
              error:
                `O provedor de e-mail recusou a entrega para ${body.email} (${evento}). ` +
                `Isso acontece quando o endereço não existe ou já devolveu uma mensagem antes — ` +
                `a partir daí ele entra numa lista de supressão e nada mais chega nele. ` +
                `Confira o endereço; se ele estiver certo, remova-o da lista de supressão no painel do Resend.`,
            };
          }
        }
      } catch (emailError) {
        // O usuário já foi criado no Supabase Auth nesse ponto (generateLink
        // cria de verdade); não desfaz, só avisa que o e-mail não saiu, pra
        // o admin poder reenviar ou mandar o link manualmente.
        reply.code(502);
        return { error: `Convite criado mas o e-mail falhou ao enviar: ${emailError instanceof Error ? emailError.message : String(emailError)}` };
      }
    } else {
      // Mesmo cuidado do ramo com Resend: `inviteUserByEmail` também lança.
      try {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, {
          data: { invited_role: body.role, invited_name: body.name ?? null },
          redirectTo,
        });
        if (error || !data.user) {
          reply.code(400);
          return { error: error?.message ?? 'Failed to send invite email' };
        }
        authUserId = data.user.id;
      } catch (erro) {
        request.log.error({ erro, email: body.email }, 'inviteUserByEmail do Supabase falhou');
        reply.code(502);
        return {
          error: `Não consegui falar com o Supabase para enviar o convite: ${erro instanceof Error ? erro.message : String(erro)}`,
        };
      }
    }

    /**
     * DAQUI PRA BAIXO A CONTA JÁ EXISTE NO SUPABASE. Se o banco falhar agora,
     * o convite foi mandado e a pessoa consegue definir senha — mas entra sem
     * papel e sem empresa, que é o estado "conta quebrada" que esta rota
     * existe para evitar. O erro precisa dizer exatamente isso, em vez de um
     * 500 que faz parecer que nada aconteceu.
     */
    try {
      const [inserido] = await db
        .insert(schema.users)
        .values({ authUserId, email: body.email, name: body.name ?? body.email.split('@')[0] ?? body.email })
        .onConflictDoNothing({ target: schema.users.authUserId })
        .returning();

      /**
       * `onConflictDoNothing` devolve NADA quando o perfil já existia — e aí o
       * papel e o vínculo eram silenciosamente pulados. Reconvidar alguém que
       * ficou sem papel (ou sem empresa) é exatamente o caso em que se reconvida.
       */
      const [user] =
        inserido !== undefined
          ? [inserido]
          : await db.select().from(schema.users).where(eq(schema.users.authUserId, authUserId));

      if (user) {
        const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, body.role));
        if (role) {
          await db
            .insert(schema.userRoles)
            .values({ userId: user.id, roleId: role.id })
            .onConflictDoNothing({ target: [schema.userRoles.userId, schema.userRoles.roleId] });
        }

        /**
         * O vínculo com a empresa de quem convidou — sem ele o convidado entra
         * num sistema vazio (ver cabeçalho da rota). O papel de EMPRESA não é o
         * mesmo vocabulário do papel de PLATAFORMA: 'owner' fica de fora de
         * propósito, porque quem responde pela empresa é decidido na criação
         * dela, não num convite.
         */
        await db
          .insert(schema.organizationMembers)
          .values({ organizationId, userId: user.id, role: body.role === 'master' ? 'admin' : 'collaborator' })
          .onConflictDoNothing({ target: [schema.organizationMembers.organizationId, schema.organizationMembers.userId] });
      }

      await db.insert(schema.auditLogs).values({
        userId: request.authUser?.id ?? null,
        organizationId,
        action: 'user.invited',
        result: 'completed',
        metadata: { email: body.email, role: body.role, organization_id: organizationId },
      });
    } catch (erro) {
      request.log.error({ erro, email: body.email, organizationId }, 'Convite criado no Supabase mas o registro local falhou');
      reply.code(502);
      return {
        error:
          `Convite criado e e-mail enviado, mas não consegui registrar a pessoa no banco: ` +
          `${erro instanceof Error ? erro.message : String(erro)}. ` +
          `Ela vai conseguir entrar, mas sem papel e sem empresa — convide de novo depois que isso for resolvido.`,
      };
    }

    reply.code(201);
    return {
      email: body.email,
      role: body.role,
      // `reconvidado` em vez de `invited` quando a conta já existia: a tela
      // precisa poder dizer "essa pessoa já tinha conta; atualizei o papel e o
      // vínculo e mandei o link da senha" em vez de fingir um convite novo.
      status: jaTinhaConta ? 'reinvited' : 'invited',
      organization_id: organizationId,
    };
    },
  );

  // Base da tela de "equipe" na central de configuração (pedido do
  // usuário): lista todo mundo com papel, status ativo/inativo e, agora,
  // quais workspaces de cliente cada um tem acesso concedido (POST
  // /clients/:id/access), pra não precisar cruzar isso manualmente cliente
  // por cliente.
  app.get('/admin/users', { preHandler: [requireAuth, requirePermission('users', 'read')] }, async (request, reply) => {
    const usuario = request.authUser;
    if (!usuario) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    /**
     * ADMINISTRAR A MINHA EMPRESA, não todas.
     *
     * A rota devolvia TODOS os usuários do banco para quem tem permissão
     * `users:read`. A permissão responde "esta pessoa pode administrar gente?"
     * — não responde "gente de qual empresa?". Com dois tenants, o
     * administrador de um veria e poderia alterar papéis do outro.
     *
     * É a distinção que este trabalho inteiro persegue: papel forte DENTRO de
     * uma empresa não é poder SOBRE todas as empresas.
     */
    const rows = await db
      .select()
      .from(schema.users)
      .where(recorteDePessoasVisiveis(usuario, schema.users.id))
      .orderBy(desc(schema.users.createdAt));
    const userIds = rows.map((user) => user.id);

    // As 3 consultas de contexto (papéis, acessos a cliente, integrações)
    // eram feitas POR usuário dentro do map: 3 x N queries, ~0.9s ao vivo
    // (RTT ~130ms pro Supabase). Em lote com inArray viram 3 no total,
    // agrupadas em memória na montagem da resposta. O formato não muda.
    const [roleRows, clientAccessRows, integrationRows] =
      userIds.length > 0
        ? await Promise.all([
            db
              .select({ userId: schema.userRoles.userId, name: schema.roles.name })
              .from(schema.userRoles)
              .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
              .where(inArray(schema.userRoles.userId, userIds)),
            db
              .select({
                userId: schema.clientUsers.userId,
                clientId: schema.clientUsers.clientId,
                clientName: schema.clients.name,
                role: schema.clientUsers.role,
              })
              .from(schema.clientUsers)
              .innerJoin(schema.clients, eq(schema.clients.id, schema.clientUsers.clientId))
              .where(inArray(schema.clientUsers.userId, userIds)),
            // Status das integrações por pessoa (pedido do Endrigo: o Admin
            // precisa ver quem está conectado ao ClickUp, em qual workspace e
            // desde quando sincronizou). NUNCA devolve o token - só metadados.
            db
              .select({
                userId: schema.integrationConnections.userId,
                provider: schema.integrationConnections.provider,
                status: schema.integrationConnections.status,
                workspaceName: schema.integrationConnections.externalWorkspaceName,
                lastSyncedAt: schema.integrationConnections.lastSyncedAt,
                connectedAt: schema.integrationConnections.createdAt,
              })
              .from(schema.integrationConnections)
              .where(inArray(schema.integrationConnections.userId, userIds)),
          ])
        : [[], [], []];

    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push(row.name);
      rolesByUser.set(row.userId, list);
    }

    const clientAccessByUser = new Map<string, Array<{ client_id: string; client_name: string; role: string }>>();
    for (const row of clientAccessRows) {
      const list = clientAccessByUser.get(row.userId) ?? [];
      list.push({ client_id: row.clientId, client_name: row.clientName, role: row.role });
      clientAccessByUser.set(row.userId, list);
    }

    type IntegrationRow = (typeof integrationRows)[number];
    const integrationsByUser = new Map<string, IntegrationRow[]>();
    for (const row of integrationRows) {
      const list = integrationsByUser.get(row.userId) ?? [];
      list.push(row);
      integrationsByUser.set(row.userId, list);
    }

    const users = rows.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatarUrl,
      active: user.active,
      roles: rolesByUser.get(user.id) ?? [],
      client_access: clientAccessByUser.get(user.id) ?? [],
      integrations: (integrationsByUser.get(user.id) ?? []).map((row) => ({
        provider: row.provider,
        status: row.status,
        workspace_name: row.workspaceName,
        last_synced_at: row.lastSyncedAt?.toISOString() ?? null,
        connected_at: row.connectedAt.toISOString(),
      })),
      created_at: user.createdAt.toISOString(),
    }));

    return { users };
  });

  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id/role',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      if (!(await exigirAlvoNaOrganizacaoDeTrabalho(request, reply, request.params.id))) return;

      const body = changeRoleSchema.parse(request.body);
      const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, body.role));
      if (!role) {
        reply.code(400);
        return { error: `Unknown role '${body.role}'` };
      }

      // Papel ANTERIOR, pra auditoria responder "de que pra que" — leitura
      // indexada pela PK (userId), barata, não um fetch de propósito.
      const [papelAnterior] = await db
        .select({ name: schema.roles.name })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
        .where(eq(schema.userRoles.userId, request.params.id));

      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, request.params.id));
      await db.insert(schema.userRoles).values({ userId: request.params.id, roleId: role.id });
      // requireAuth guarda papéis/permissões em cache curto por processo -
      // sem isto, o papel novo só valeria depois do TTL.
      invalidateUserAccessCache(request.params.id);

      await auditarAcao(request, {
        action: 'user.role_changed',
        resourceType: 'user',
        resourceId: request.params.id,
        oldValue: { role: papelAnterior?.name ?? null },
        newValue: { role: body.role },
      });

      return { id: request.params.id, role: body.role };
    },
  );

  // users.active existia desde o schema inicial mas não tinha rota nenhuma
  // pra mudar: nem fazia diferença desativar alguém (achado na auditoria
  // de RBAC, ver requireAuth em auth/middleware.ts, que agora checa isso).
  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id/status',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      if (!(await exigirAlvoNaOrganizacaoDeTrabalho(request, reply, request.params.id))) return;

      const body = changeStatusSchema.parse(request.body);

      const [antes] = await db.select({ active: schema.users.active }).from(schema.users).where(eq(schema.users.id, request.params.id));

      const [updated] = await db
        .update(schema.users)
        .set({ active: body.active, updatedAt: new Date() })
        .where(eq(schema.users.id, request.params.id))
        .returning();

      if (!updated) {
        reply.code(404);
        return { error: `User '${request.params.id}' not found` };
      }
      // Desativar alguém precisa valer na hora, não depois do TTL do cache.
      invalidateUserAccessCache(updated.authUserId ?? request.params.id);

      await auditarAcao(request, {
        action: body.active ? 'user.activated' : 'user.deactivated',
        resourceType: 'user',
        resourceId: request.params.id,
        oldValue: { active: antes?.active ?? null },
        newValue: { active: updated.active },
      });

      return { id: updated.id, active: updated.active };
    },
  );

  // Editar nome de outro usuário (master), separado de PATCH /me (o
  // próprio usuário editando a si mesmo).
  app.patch<{ Params: { id: string } }>(
    '/admin/users/:id',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      if (!(await exigirAlvoNaOrganizacaoDeTrabalho(request, reply, request.params.id))) return;

      const body = updateUserSchema.parse(request.body);

      const [antes] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, request.params.id));

      const [updated] = await db
        .update(schema.users)
        .set({ name: body.name, updatedAt: new Date() })
        .where(eq(schema.users.id, request.params.id))
        .returning();

      if (!updated) {
        reply.code(404);
        return { error: `User '${request.params.id}' not found` };
      }
      invalidateUserAccessCache(updated.authUserId ?? request.params.id);

      // Auditoria P0-A (06/10/2026): esta rota mutava o nome sem deixar
      // NENHUM rastro — nem metadata solta, nada. As outras 3 mutações já
      // gravavam audit_logs; esta era a exceção.
      await auditarAcao(request, {
        action: 'user.renamed',
        resourceType: 'user',
        resourceId: request.params.id,
        oldValue: { name: antes?.name ?? null },
        newValue: { name: updated.name },
      });

      return { id: updated.id, name: updated.name };
    },
  );

  // Apagar de verdade (Supabase Auth + nossa tabela), não é o mesmo que
  // desativar. Golden rule 7 (auditoria de tudo) significa que quem já fez
  // alguma coisa de verdade no sistema (execução, log de auditoria,
  // mensagem, conversa) não pode ser apagado sem perder rastro de quem fez
  // o quê; nesse caso a rota recusa com 409 e aponta pra
  // PATCH /admin/users/:id/status em vez de apagar. Só remove de verdade
  // um usuário "limpo" (convidado por engano, nunca fez nada).
  app.delete<{ Params: { id: string } }>(
    '/admin/users/:id',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (request, reply) => {
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.params.id));
      if (!user) {
        reply.code(404);
        return { error: `User '${request.params.id}' not found` };
      }
      if (!(await exigirAlvoNaOrganizacaoDeTrabalho(request, reply, request.params.id))) return;

      /**
       * EXCLUSÃO É INCONDICIONAL PRA QUEM ADMINISTRA (pedido direto do Pedro,
       * 08/10/2026, depois de travar numa conta de teste com histórico):
       * administrador apaga qualquer conta, histórico incluso, sem pedir
       * segunda permissão. A versão anterior recusava com 409 quando a pessoa
       * tinha execução/auditoria/conversa/mensagem — e isso sobrava
       * justamente nas contas de QA/teste que mais precisam ser limpas.
       *
       * O QUE CONTINUA SENDO PRESERVADO, por causa do schema, não de um
       * `if` aqui: `conversations.userId` e `direct_messages.{sender,
       * recipient}_id` são `onDelete: 'cascade'` (somem junto, de propósito —
       * mensagem sem dono não serve pra nada) e `audit_logs.userId` é
       * `onDelete: 'set null'` (a linha do que aconteceu fica, só perde o
       * vínculo com uma conta que não existe mais — é o comportamento certo
       * de log de auditoria: o evento não deixa de ter acontecido). Só
       * `executions.userId` é `NOT NULL` + `restrict`, e precisa da linha
       * explícita abaixo — sem ela o DELETE de `users` falha com violação de
       * FK em vez de limpar.
       *
       * MAS ELE NÃO É O ÚNICO, e afirmar que era custou um 500 em produção
       * (relato do Pedro, 09/10/2026: "pedin barroso09: Internal Server Error"
       * enquanto as outras contas recebiam mensagem clara). Há mais CINCO
       * referências `NOT NULL` + `restrict` a `users`, todas de tabelas que
       * nasceram depois deste comentário: demands.created_by,
       * briefs.created_by, calendar_events.created_by,
       * approval_requests.requested_by e client_reports.requested_by.
       *
       * Essas cinco NÃO são apagadas junto, de propósito. Execução é registro
       * de máquina; demanda, briefing, evento de agenda, pedido de aprovação e
       * relatório são TRABALHO DA AGÊNCIA, que não deixa de existir porque quem
       * criou saiu. Apagá-los pra viabilizar a exclusão de uma conta destruiria
       * entrega de cliente pra limpar um cadastro.
       *
       * Então a conta com esse vínculo é recusada com 409 e a razão nomeada —
       * não com "Internal Server Error", que não diz nada e ainda parece
       * defeito do sistema. A exclusão segue incondicional pra todo o resto
       * (execução, auditoria, conversa, mensagem), que é o caso das contas de
       * QA que o Pedro precisa limpar.
       */
      const bloqueios = await Promise.all([
        db.select({ id: schema.demands.id }).from(schema.demands).where(eq(schema.demands.createdBy, request.params.id)).limit(1),
        db.select({ id: schema.briefs.id }).from(schema.briefs).where(eq(schema.briefs.createdBy, request.params.id)).limit(1),
        db.select({ id: schema.calendarEvents.id }).from(schema.calendarEvents).where(eq(schema.calendarEvents.createdBy, request.params.id)).limit(1),
        db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(eq(schema.approvalRequests.requestedBy, request.params.id)).limit(1),
        db.select({ id: schema.clientReports.id }).from(schema.clientReports).where(eq(schema.clientReports.requestedBy, request.params.id)).limit(1),
      ]);
      const NOMES_DO_BLOQUEIO = ['demandas', 'briefings', 'eventos de agenda', 'pedidos de aprovação', 'relatórios de cliente'];
      const impedem = bloqueios.map((linhas, i) => (linhas.length > 0 ? NOMES_DO_BLOQUEIO[i] : null)).filter(Boolean);
      if (impedem.length > 0) {
        reply.code(409);
        return {
          error: `Esta pessoa criou ${impedem.join(', ')} — trabalho da agência, que não some junto com a conta. Use "Desativar": corta o acesso na hora e mantém a entrega no lugar.`,
        };
      }

      await db.delete(schema.executions).where(eq(schema.executions.userId, request.params.id));

      const supabaseUrl = process.env.SUPABASE_URL;
      const secretKey = process.env.SUPABASE_SECRET_KEY;
      if (user.authUserId && supabaseUrl && secretKey) {
        const admin = getSupabaseAdminClient(supabaseUrl, secretKey);
        await admin.auth.admin.deleteUser(user.authUserId);
      }

      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, request.params.id));
      await db.delete(schema.clientUsers).where(eq(schema.clientUsers.userId, request.params.id));
      await db.delete(schema.notifications).where(eq(schema.notifications.userId, request.params.id));
      await db.delete(schema.users).where(eq(schema.users.id, request.params.id));
      invalidateUserAccessCache(user.authUserId ?? request.params.id);

      // Auditoria P0-A (06/10/2026): a rota mais destrutiva das quatro era a
      // que não deixava NENHUM rastro da própria exclusão — só lia
      // audit_logs como checagem prévia, nunca escrevia o próprio ato.
      // `resourceId` fica como texto solto de propósito: a linha de
      // `users` já não existe mais pra uma FK apontar pra ela.
      await auditarAcao(request, {
        action: 'user.deleted',
        resourceType: 'user',
        resourceId: request.params.id,
        oldValue: { email: user.email, name: user.name, active: user.active },
        newValue: null,
      });

      return { id: request.params.id, deleted: true };
    },
  );
}
