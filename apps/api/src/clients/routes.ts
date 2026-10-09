import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { naturezaDoCliente } from '@desigual-os/context-engine';
import {
  getGoogleAdsAccountInsights,
  getGoogleAdsAccounts,
  getGoogleAdsCampaigns,
  getMetaAccountInsights,
  getMetaAds,
  getMetaAdAccounts,
  getMetaCampaigns,
  getTaskComments,
  getTasksInList,
  getTasksInListPaged,
} from '@desigual-os/tool-gateway';
import type { ClickUpTaskSummary } from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { recordOperationalEvent, enqueueClientReport } from '@desigual-os/orchestrator';
import { CLIENT_RESPONSIBILITIES } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { hasClientAccess } from '../lib/access';
import { auditarAcao } from '../lib/auditoria';
import { clientBelongsToTenant, requireTenant } from '../lib/tenant-context';
import { resolveClickUpAccess } from '../integrations/access';
import { resolveMetaAccess, resolveMetaAccessByConnectionId } from '../integrations/meta-access';
import { getGoogleAdsEnvConfig, resolveGoogleAdsAccess, resolveGoogleAdsAccessByConnectionId } from '../integrations/google-ads-access';

const logger = createLogger({ service: 'clients' });

// Agregação de comentários: buscar comentários de TODA a lista estoura o
// rate limit do ClickUp em listas grandes, então só as 10 tarefas mexidas
// mais recentemente (onde a conversa viva acontece), 5 chamadas por vez.
const COMMENTS_TASK_LIMIT = 10;
const COMMENTS_CONCURRENCY = 5;
const COMMENTS_TOTAL_LIMIT = 50;

interface ClientClickUpComment {
  id: string;
  text: string;
  user_id: number | null;
  username: string | null;
  date: string;
  task_id: string;
  task_name: string;
  task_url: string | null;
}

/** Comentários das tarefas mais recentes da lista, mesclados e ordenados do
 * mais novo pro mais velho. Tarefa que falha individualmente é pulada (uma
 * tarefa apagada no ClickUp no meio do caminho não derruba o painel todo). */
async function fetchAggregatedComments(tasks: ClickUpTaskSummary[], config: { apiKey: string; teamId: string }): Promise<ClientClickUpComment[]> {
  const recentTasks = [...tasks]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, COMMENTS_TASK_LIMIT);

  const merged: ClientClickUpComment[] = [];
  for (let i = 0; i < recentTasks.length; i += COMMENTS_CONCURRENCY) {
    const batch = recentTasks.slice(i, i + COMMENTS_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((task) => getTaskComments(config, task.id)));
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        logger.warn({ taskId: batch[index]?.id }, 'Falha ao buscar comentários de uma tarefa; pulando');
        return;
      }
      const task = batch[index]!;
      for (const comment of result.value) {
        merged.push({
          id: comment.id,
          text: comment.text,
          user_id: comment.userId,
          username: comment.username,
          date: comment.date,
          task_id: task.id,
          task_name: task.name,
          task_url: task.url,
        });
      }
    });
  }

  return merged.sort((a, b) => Number(b.date) - Number(a.date)).slice(0, COMMENTS_TOTAL_LIMIT);
}

const createClientSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug deve ser kebab-case (a-z, 0-9, hífen)'),
});

const grantAccessSchema = z.object({
  email: z.string().email(),
  role: z.enum(['viewer', 'editor']).default('viewer'),
});

const assignmentSchema = z.object({
  userId: z.string().uuid(),
  responsibility: z.enum(CLIENT_RESPONSIBILITIES),
});

/** `account_id` vem no formato "act_123..." que a própria Graph API devolve e exige de volta. */
const linkMetaAccountSchema = z.object({
  account_id: z.string().trim().min(1),
  business_id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  is_primary: z.boolean().optional(),
});

const reportRequestSchema = z.object({
  channels: z.array(z.enum(['meta', 'google_ads'])).min(1, 'Selecione ao menos um canal.'),
  period_days: z.number().int().min(1).max(365).default(30),
});

function apresentacaoDoRelatorio(row: typeof schema.clientReports.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    channels: row.channels,
    period_days: row.periodDays,
    period_start: row.periodStart.toISOString(),
    period_end: row.periodEnd.toISOString(),
    storage_url: row.storageUrl,
    error_message: row.errorMessage,
    created_at: row.createdAt.toISOString(),
  };
}

const linkGoogleAdsAccountSchema = z.object({
  customer_id: z.string().trim().regex(/^\d+$/, 'customer_id deve ser só os dígitos, sem hífen.'),
  login_customer_id: z.string().trim().regex(/^\d+$/, 'login_customer_id deve ser só os dígitos, sem hífen.').optional(),
  label: z.string().trim().min(1).max(80).optional(),
  is_primary: z.boolean().optional(),
});

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
    if (reply.sent) return;
    const { id } = request.params as { id?: string };
    if (id && !(await clientBelongsToTenant(id, request.tenantContext!.organizationId))) {
      reply.code(404).send({ error: 'Client not found' });
    }
  });
  app.get('/clients', { preHandler: [requireAuth, requirePermission('clients', 'read')] }, async (request) => {
    /**
     * QUANDO CADA CLIENTE SE MEXEU PELA ÚLTIMA VEZ.
     *
     * Até aqui esta rota devolvia nome, slug, status e vínculo do ClickUp — o
     * cadastro. Com isso a tela de Clientes não tinha como responder a pergunta
     * que de fato importa para quem gere uma agência: qual cliente parou. Conta
     * que esfria é a primeira evidência de cliente indo embora, e ela aparece
     * semanas antes do aviso.
     *
     * TRÊS FONTES, e nenhuma sozinha serve. `messages` não tem `client_id` (liga
     * por conversa); `memories` e `executions` têm. Usar só uma faria um cliente
     * que só conversa parecer parado, ou um que só gera peça parecer sumido.
     *
     * EM PARALELO com a listagem, de propósito: medido, a consulta custa 60-200ms
     * acima da ida de rede (141ms). Em sequência ela somaria uma viagem inteira
     * a uma tela que a equipe abre o dia todo.
     */
    const atividadePorCliente = db
      .execute(
        sql`select c.id,
              greatest(
                (select max(m.created_at) from messages m
                   join conversations cv on cv.id = m.conversation_id
                  where cv.client_id = c.id),
                (select max(mem.created_at) from memories mem where mem.client_id = c.id),
                (select max(e.created_at) from executions e where e.client_id = c.id)
              ) as ultima,
              (select count(*)::int from executions e
                where e.client_id = c.id and e.created_at > now() - interval '30 days') as pedidos_30d
            from clients c
            where c.organization_id = ${request.tenantContext!.organizationId}::uuid
              and c.deleted_at is null`,
      )
      .catch(() => null);

    const rows = await db
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        slug: schema.clients.slug,
        status: schema.clients.status,
        clickupListId: schema.clients.clickupListId,
      })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, request.tenantContext!.organizationId))
      .orderBy(desc(schema.clients.createdAt));

    // A listagem precisa do vínculo também: sem isso o card na tela de
    // Clientes dizia "sem vínculo no ClickUp" pra TODO mundo, mesmo com o
    // cliente importado de lá (só o workspace devolvia esse campo).
    const teamId = process.env.CLICKUP_TEAM_ID;

    const bruto = await atividadePorCliente;
    const linhas = ((bruto as { rows?: unknown[] } | null)?.rows ??
      (bruto as unknown[] | null) ??
      []) as Array<{ id: string; ultima: string | Date | null; pedidos_30d: number }>;
    const atividade = new Map(linhas.map((l) => [l.id, l]));
    /**
     * A CONSULTA FALHOU É DIFERENTE DE NINGUÉM SE MEXEU. Se ela não voltou, o
     * campo vai `undefined` e a tela diz "não consegui ler" — nunca "parado há
     * muito tempo", que seria inventar um alarme a partir de um erro de leitura.
     */
    const atividadeLida = bruto !== null;
    return {
      clients: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        clickup_list_id: row.clickupListId,
        clickup_url: row.clickupListId && teamId ? `https://app.clickup.com/${teamId}/v/li/${row.clickupListId}` : null,
        /**
         * CLIENTE, TRABALHO INTERNO OU FIXTURE DE TESTE.
         *
         * Vem do MESMO classificador que o backend usa pra decidir o que entra
         * numa consulta de operação (`naturezaDoCliente`, context-engine). Sai
         * daqui como campo em vez de a tela reimplementar a regra, porque duas
         * definições da mesma coisa em lugares diferentes foi exatamente como o
         * sistema passou a dizer "58 clientes" numa tela e "49" na outra.
         *
         * A listagem continua devolvendo TUDO: quem esconde é quem apresenta.
         * Filtrar aqui quebraria a tela de Clientes, que precisa mostrar a
         * fixture pra alguém poder apagá-la.
         */
        natureza: naturezaDoCliente(row.name),
        /**
         * `null` = nunca se mexeu, que é um estado legítimo (cliente recém
         * cadastrado). `undefined` = não deu para ler. A tela trata os dois de
         * um jeito diferente, e precisa poder.
         */
        ultima_atividade: !atividadeLida
          ? undefined
          : atividade.get(row.id)?.ultima
            ? new Date(atividade.get(row.id)!.ultima!).toISOString()
            : null,
        pedidos_30d: atividadeLida ? (atividade.get(row.id)?.pedidos_30d ?? 0) : undefined,
      })),
      atividade_lida: atividadeLida,
    };
  });

  app.post(
    '/clients',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const body = createClientSchema.parse(request.body);

      const [client] = await db.insert(schema.clients).values({ ...body, organizationId: request.tenantContext!.organizationId }).onConflictDoNothing({ target: schema.clients.slug }).returning();

      if (!client) {
        reply.code(409);
        return { error: `Client with slug '${body.slug}' already exists` };
      }

      await auditarAcao(request, {
        action: 'client.created',
        clientId: client.id,
        metadata: { name: client.name, slug: client.slug },
      });

      reply.code(201);
      return { id: client.id, name: client.name, slug: client.slug, status: client.status };
    },
  );

  app.get<{ Params: { id: string } }>('/clients/:id', { preHandler: [requireAuth, requirePermission('clients', 'read')] }, async (request, reply) => {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, request.params.id));
    if (!client) {
      reply.code(404);
      return { error: `Client '${request.params.id}' not found` };
    }

    return { id: client.id, name: client.name, slug: client.slug, status: client.status };
  });

  // Workspace agregado do cliente (pedido do usuário): tudo que o Bento, a
  // Susy e o Jarbas alimentaram sobre ele, num lugar só. Projetos são
  // compartilhados pela equipe (2026-09-03): qualquer master/colaborador
  // autenticado acessa, ver hasClientAccess em lib/access.ts.
  app.get<{ Params: { id: string } }>(
    '/clients/:id/workspace',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }

      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }

      const [conversationRows, assetRows, executionRows, [project]] = await Promise.all([
        db.select().from(schema.conversations).where(eq(schema.conversations.clientId, clientId)).orderBy(desc(schema.conversations.updatedAt)).limit(20),
        db.select().from(schema.studioAssets).where(eq(schema.studioAssets.clientId, clientId)).orderBy(desc(schema.studioAssets.createdAt)).limit(20),
        db.select().from(schema.executions).where(eq(schema.executions.clientId, clientId)).orderBy(desc(schema.executions.createdAt)).limit(20),
        // Projeto de chat vinculado a este cliente (tela de Clientes ainda não
        // tinha como abrir o chat dele: faltava esse id pro botão "Abrir chat").
        db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.clientId, clientId)).limit(1),
      ]);

      const totalCost = executionRows.reduce((sum, row) => sum + Number(row.actualCost ?? row.estimatedCost ?? 0), 0);

      return {
        client: {
          id: client.id,
          name: client.name,
          slug: client.slug,
          status: client.status,
          clickup_list_id: client.clickupListId,
          project_id: project?.id ?? null,
          // Deep link direto pra lista do cliente no ClickUp. Embutir o
          // ClickUp por iframe NÃO é possível: o CSP dele responde
          // `frame-ancestors 'self' https://clickup.com` (verificado nos
          // headers em 03/09/2026), então o browser recusa. Abrir em aba
          // nova é o caminho suportado.
          clickup_url:
            client.clickupListId && process.env.CLICKUP_TEAM_ID
              ? `https://app.clickup.com/${process.env.CLICKUP_TEAM_ID}/v/li/${client.clickupListId}`
              : null,
        },
        conversations: conversationRows.map((row) => ({ id: row.id, title: row.title, status: row.status, updated_at: row.updatedAt.toISOString() })),
        studio_assets: assetRows.map((row) => ({
          id: row.id,
          type: row.type,
          filename: row.filename,
          storage_url: row.storageUrl,
          created_at: row.createdAt.toISOString(),
        })),
        executions: executionRows.map((row) => ({
          id: row.id,
          execution_id: row.executionId,
          agent: row.agent,
          status: row.status,
          created_at: row.createdAt.toISOString(),
        })),
        cost_summary: { total_cost: totalCost, execution_count: executionRows.length },
      };
    },
  );

  // Concessão de acesso ao workspace (pedido do usuário), só master.
  // Assume que o colaborador já tem conta no Desigual OS; convite de
  // alguém sem conta ainda usa POST /admin/invite primeiro (não dá pra
  // pré-criar o perfil aqui sem colidir com o provisionamento just-in-time
  // que já existe em resolveOrProvisionUser, que casa por auth_user_id).
  app.post<{ Params: { id: string } }>(
    '/clients/:id/access',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const body = grantAccessSchema.parse(request.body);

      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }

      const [targetUser] = await db.select({ id: schema.users.id }).from(schema.users)
        .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
        .where(and(eq(schema.users.email, body.email), eq(schema.organizationMembers.organizationId, request.tenantContext!.organizationId)));
      if (!targetUser) {
        reply.code(404);
        return { error: `No Desigual OS account found for '${body.email}'. Use POST /admin/invite first to create one.` };
      }

      // Alvo do conflito inclui `responsibility` (migração 0056, P0-C): esta
      // rota nunca define responsabilidade, então sempre mexe na linha de
      // ACESSO (responsibility IS NULL) — nunca numa linha de
      // responsabilidade operacional que já exista para esta pessoa.
      await db
        .insert(schema.clientUsers)
        .values({ clientId, userId: targetUser.id, role: body.role })
        .onConflictDoUpdate({
          target: [schema.clientUsers.clientId, schema.clientUsers.userId, schema.clientUsers.responsibility],
          set: { role: body.role },
        });

      // E-mail transacional dedicado (ex: Resend/Postmark) não está
      // configurado ainda; a notificação real que existe hoje é in-app.
      await db.insert(schema.notifications).values({
        userId: targetUser.id,
        type: 'workspace_access_granted',
        title: `Acesso liberado: ${client.name}`,
        body: `Você agora tem acesso ao workspace do cliente ${client.name} como ${body.role}.`,
      });

      reply.code(201);
      return { client_id: clientId, user_id: targetUser.id, role: body.role };
    },
  );

  /**
   * CLIENT ASSIGNMENT (P0-C, 06/10/2026): responsabilidade OPERACIONAL de um
   * membro sobre o cliente (account/traffic/design/...) — distinta do
   * `role` de acesso ao workspace acima (viewer/editor). A mesma pessoa pode
   * ter várias responsabilidades no mesmo cliente (Tammy é manager E account
   * da Cosentino); o mesmo cliente pode ter várias pessoas na mesma
   * responsabilidade. `responsibility IS NULL` é a linha de ACESSO (gravada
   * pela rota acima), nunca aparece aqui.
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/assignments',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request) => {
      const rows = await db
        .select({
          userId: schema.clientUsers.userId,
          userName: schema.users.name,
          userEmail: schema.users.email,
          responsibility: schema.clientUsers.responsibility,
        })
        .from(schema.clientUsers)
        .innerJoin(schema.users, eq(schema.users.id, schema.clientUsers.userId))
        .where(and(eq(schema.clientUsers.clientId, request.params.id), isNotNull(schema.clientUsers.responsibility)))
        .orderBy(asc(schema.clientUsers.responsibility));

      return {
        assignments: rows.map((r) => ({
          user_id: r.userId,
          user_name: r.userName,
          user_email: r.userEmail,
          responsibility: r.responsibility,
        })),
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/clients/:id/assignments',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const body = assignmentSchema.parse(request.body);

      // Mesma checagem de `/clients/:id/access`: o alvo precisa ser membro
      // da MESMA empresa — nunca atribuir responsabilidade a alguém de fora.
      const [targetUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
        .where(and(eq(schema.users.id, body.userId), eq(schema.organizationMembers.organizationId, request.tenantContext!.organizationId)));
      if (!targetUser) {
        reply.code(404);
        return { error: `User '${body.userId}' is not a member of this organization` };
      }

      // Idempotente: chamar de novo com o MESMO par (usuário, responsabilidade)
      // não duplica linha — a unique constraint (migração 0056) já garante isso.
      await db
        .insert(schema.clientUsers)
        .values({ clientId, userId: body.userId, responsibility: body.responsibility })
        .onConflictDoNothing({
          target: [schema.clientUsers.clientId, schema.clientUsers.userId, schema.clientUsers.responsibility],
        });

      await auditarAcao(request, {
        action: 'client.assignment_set',
        resourceType: 'client',
        resourceId: clientId,
        newValue: { userId: body.userId, responsibility: body.responsibility },
      });
      await recordOperationalEvent({
        source: 'system',
        type: 'client.assignment_set',
        organizationId: request.tenantContext!.organizationId,
        userId: request.authUser?.id ?? null,
        clientId,
        entityType: 'client_assignment',
        entityId: `${clientId}:${body.userId}:${body.responsibility}`,
        summary: `Atribuiu responsabilidade de ${body.responsibility} a um membro.`,
        payload: { target_user_id: body.userId, responsibility: body.responsibility },
      });

      reply.code(201);
      return { client_id: clientId, user_id: body.userId, responsibility: body.responsibility };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/clients/:id/assignments',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const body = assignmentSchema.parse(request.body);

      const deleted = await db
        .delete(schema.clientUsers)
        .where(
          and(
            eq(schema.clientUsers.clientId, clientId),
            eq(schema.clientUsers.userId, body.userId),
            eq(schema.clientUsers.responsibility, body.responsibility),
          ),
        )
        .returning({ id: schema.clientUsers.id });

      if (deleted.length === 0) {
        reply.code(404);
        return { error: 'Assignment not found' };
      }

      await auditarAcao(request, {
        action: 'client.assignment_removed',
        resourceType: 'client',
        resourceId: clientId,
        oldValue: { userId: body.userId, responsibility: body.responsibility },
      });
      await recordOperationalEvent({
        source: 'system',
        type: 'client.assignment_removed',
        organizationId: request.tenantContext!.organizationId,
        userId: request.authUser?.id ?? null,
        clientId,
        entityType: 'client_assignment',
        entityId: `${clientId}:${body.userId}:${body.responsibility}`,
        summary: `Removeu responsabilidade de ${body.responsibility} de um membro.`,
        payload: { target_user_id: body.userId, responsibility: body.responsibility },
      });

      return { client_id: clientId, user_id: body.userId, responsibility: body.responsibility, removed: true };
    },
  );

  /**
   * Brand kit consolidado pro Studio: junta o branding geral
   * (client_brand_kits) com as referências visuais específicas de geração
   * (studio_brand_kits). Cliente sem kit NÃO é 404: devolve 200 com campos
   * null/[] pra tela renderizar o estado vazio sem tratar exceção.
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/brand-kit',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
    const clientId = request.params.id;
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!client) {
      reply.code(404);
      return { error: `Client '${clientId}' not found` };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
      reply.code(403);
      return { error: 'No access granted to this client' };
    }

    const [brandKit, studioKit] = await Promise.all([
      db.select().from(schema.clientBrandKits).where(eq(schema.clientBrandKits.clientId, clientId)),
      db.select().from(schema.studioBrandKits).where(eq(schema.studioBrandKits.clientId, clientId)),
    ]);

    return {
      client_id: clientId,
      logo_url: brandKit[0]?.logoUrl ?? null,
      colors: brandKit[0]?.colors ?? [],
      fonts: brandKit[0]?.fonts ?? [],
      tone_of_voice: brandKit[0]?.toneOfVoice ?? null,
      reference_images: studioKit[0]?.referenceImages ?? [],
    };
    },
  );

  /**
   * Write path do Brand Kit (até 11/09/2026 NÃO existia: client_brand_kits e
   * studio_brand_kits só eram populadas por SQL manual, e o loop de DNA do
   * Otto ficava inerte pra cliente sem kit). Upsert nas duas tabelas de uma
   * vez — o GET acima lê as duas juntas, então a escrita também grava as
   * duas juntas, senão o painel mostraria metade do que foi salvo.
   *
   * Campos omitidos NÃO são apagados (merge com o que já existe): a tela
   * manda o formulário inteiro, mas um caller parcial (ex: futuro importador
   * de manual de marca em PDF) não destrói o resto por omissão. Pra limpar
   * um campo, mande null/[] explicitamente.
   */
  const upsertBrandKitSchema = z.object({
    logo_url: z.string().url().nullable().optional(),
    colors: z.array(z.string().min(1)).max(24).optional(),
    fonts: z.array(z.string().min(1)).max(12).optional(),
    tone_of_voice: z.string().nullable().optional(),
    reference_images: z.array(z.string().url()).max(20).optional(),
  });

  app.put<{ Params: { id: string } }>(
    '/clients/:id/brand-kit',
    { preHandler: [requireAuth, requirePermission('clients', 'write')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const body = upsertBrandKitSchema.parse(request.body ?? {});

      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [brandKit, studioKit] = await Promise.all([
        db.select().from(schema.clientBrandKits).where(eq(schema.clientBrandKits.clientId, clientId)),
        db.select().from(schema.studioBrandKits).where(eq(schema.studioBrandKits.clientId, clientId)),
      ]);
      const currentKit = brandKit[0];
      const currentStudioKit = studioKit[0];

      const merged = {
        logoUrl: body.logo_url !== undefined ? body.logo_url : (currentKit?.logoUrl ?? null),
        colors: body.colors ?? currentKit?.colors ?? [],
        fonts: body.fonts ?? currentKit?.fonts ?? [],
        toneOfVoice: body.tone_of_voice !== undefined ? body.tone_of_voice : (currentKit?.toneOfVoice ?? null),
      };
      const mergedReferenceImages = body.reference_images ?? currentStudioKit?.referenceImages ?? [];

      await db
        .insert(schema.clientBrandKits)
        .values({ clientId, ...merged })
        .onConflictDoUpdate({ target: schema.clientBrandKits.clientId, set: { ...merged, updatedAt: new Date() } });

      await db
        .insert(schema.studioBrandKits)
        .values({ clientId, referenceImages: mergedReferenceImages })
        .onConflictDoUpdate({
          target: schema.studioBrandKits.clientId,
          set: { referenceImages: mergedReferenceImages, updatedAt: new Date() },
        });

      await auditarAcao(request, {
        action: 'client.brand_kit_saved',
        clientId,
        metadata: {
          colors: merged.colors.length,
          fonts: merged.fonts.length,
          reference_images: mergedReferenceImages.length,
          has_logo: merged.logoUrl !== null,
          has_tone_of_voice: merged.toneOfVoice !== null,
        },
      });

      return {
        client_id: clientId,
        logo_url: merged.logoUrl,
        colors: merged.colors,
        fonts: merged.fonts,
        tone_of_voice: merged.toneOfVoice,
        reference_images: mergedReferenceImages,
      };
    },
  );

  /**
   * Memória consolidada do cliente (kind 'client.profile' em `memories`):
   * dossiê reunido de histórico de conversas, ClickUp e material entregue,
   * usado pela tela de Projeto no chat pra mostrar "memória, informações e
   * padrões" antes de começar uma conversa nova ali dentro. Sem registro
   * ainda é 200 com content null (estado vazio honesto, não 404).
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/memory',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
    const clientId = request.params.id;
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (!client) {
      reply.code(404);
      return { error: `Client '${clientId}' not found` };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
      reply.code(403);
      return { error: 'No access granted to this client' };
    }

    const [memory] = await db
      .select()
      .from(schema.memories)
      .where(and(eq(schema.memories.clientId, clientId), eq(schema.memories.kind, 'client.profile')))
      .orderBy(desc(schema.memories.updatedAt))
      .limit(1);

    return {
      client_id: clientId,
      content: memory?.content ?? null,
      metadata: memory?.metadata ?? null,
      updated_at: memory?.updatedAt.toISOString() ?? null,
    };
    },
  );

  /**
   * Tarefas REAIS do cliente, lidas direto do ClickUp na hora (não do
   * espelho local): o ClickUp é a fonte de verdade, então a tela mostra o
   * que está lá agora, sem risco de exibir cópia velha. Exige o mesmo
   * acesso do workspace do cliente.
   */
  app.get<{ Params: { id: string }; Querystring: { include_closed?: string } }>(
    '/clients/:id/clickup/tasks',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }
      if (!client.clickupListId) {
        reply.code(409);
        return { error: 'Client is not linked to a ClickUp list yet. Run the ClickUp sync first.' };
      }

      const access = await resolveClickUpAccess(request.authUser.id);
      if (!access) {
        reply.code(400);
        return { error: 'No ClickUp access available for this user' };
      }

      try {
        const tasks = await getTasksInList(access.token, client.clickupListId, request.query.include_closed === 'true');
        return {
          tasks: tasks.map((task) => ({
            id: task.id,
            name: task.name,
            description: task.description,
            status: task.status,
            status_color: task.statusColor,
            status_type: task.statusType,
            priority: task.priority,
            priority_color: task.priorityColor,
            url: task.url,
            due_date: task.dueDate,
            start_date: task.startDate,
            created_at: task.createdAt,
            updated_at: task.updatedAt,
            time_estimate_ms: task.timeEstimateMs,
            tags: task.tags.map((tag) => ({ name: tag.name, background: tag.background, foreground: tag.foreground })),
            // Fotos reais dos usuários do ClickUp (profilePicture): pedido
            // explícito do Endrigo pra reconhecer quem é quem sem ler nome.
            assignees: task.assignees.map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatarUrl, initials: p.initials, color: p.color })),
            creator: task.creator
              ? { id: task.creator.id, name: task.creator.name, avatar_url: task.creator.avatarUrl, initials: task.creator.initials, color: task.creator.color }
              : null,
          })),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error, clientId }, 'Falha ao buscar tarefas do ClickUp');
        reply.code(502);
        return { error: message };
      }
    },
  );

  /**
   * TODOS os comentários das tarefas do cliente numa thread só (pedido do
   * usuário): em vez de escolher uma tarefa por vez, a aba Conversas mostra
   * a conversa inteira do cliente, cada item dizendo de qual tarefa veio.
   * Limitado às tarefas mais recentes por causa do rate limit do ClickUp
   * (ver constantes no topo do arquivo).
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/comments',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }
      if (!client.clickupListId) {
        reply.code(409);
        return { error: 'Client is not linked to a ClickUp list yet. Run the ClickUp sync first.' };
      }

      const access = await resolveClickUpAccess(request.authUser.id);
      if (!access) {
        reply.code(400);
        return { error: 'No ClickUp access available for this user' };
      }

      try {
        const tasks = await getTasksInList(access.token, client.clickupListId);
        return { comments: await fetchAggregatedComments(tasks, { apiKey: access.token, teamId: access.teamId }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error, clientId }, 'Falha ao agregar comentários do ClickUp');
        reply.code(502);
        return { error: message };
      }
    },
  );

  /**
   * Resumo sempre atualizado do cliente (aba Visão Geral): totais de tarefas
   * do ClickUp por status, últimos comentários, assets do Studio e conversas
   * do Desigual OS. Tudo lido na hora; o que não existir (cliente sem lista
   * vinculada, por exemplo) vem como estado vazio/null, nunca inventado.
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/overview',
    { preHandler: [requireAuth, requirePermission('clients', 'read')] },
    async (request, reply) => {
      const clientId = request.params.id;
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!client) {
        reply.code(404);
        return { error: `Client '${clientId}' not found` };
      }
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client workspace' };
      }

      const [conversationCountRow, assetCountRow, recentConversations, recentAssets] = await Promise.all([
        db.select({ value: count() }).from(schema.conversations).where(eq(schema.conversations.clientId, clientId)),
        db.select({ value: count() }).from(schema.studioAssets).where(eq(schema.studioAssets.clientId, clientId)),
        db.select().from(schema.conversations).where(eq(schema.conversations.clientId, clientId)).orderBy(desc(schema.conversations.updatedAt)).limit(5),
        db.select().from(schema.studioAssets).where(eq(schema.studioAssets.clientId, clientId)).orderBy(desc(schema.studioAssets.createdAt)).limit(4),
      ]);

      // Sem lista vinculada o ClickUp não entra no resumo (null = estado
      // vazio honesto), mas o resto do resumo continua valendo.
      let clickup: {
        total_tasks: number;
        /** true = a busca bateu no teto de páginas, então `total_tasks` é um MÍNIMO.
         * A UI tem que dizer "mínimo"/"+" em vez de afirmar o número como total. */
        counts_truncated: boolean;
        open_tasks: number;
        by_status: Array<{ status: string; color: string | null; count: number }>;
        latest_comments: ClientClickUpComment[];
      } | null = null;

      if (client.clickupListId) {
        const access = await resolveClickUpAccess(request.authUser.id);
        if (!access) {
          reply.code(400);
          return { error: 'No ClickUp access available for this user' };
        }
        try {
          // Paginado de propósito: até 10/09/2026 esta contagem usava só a primeira página
          // (100 tarefas) e exibia o resultado como se fosse o total do cliente. Cliente
          // grande aparecia com número errado sem nenhum sinal de erro. `truncated` sobe pro
          // wire pra que a UI possa dizer "mínimo" em vez de afirmar um total falso.
          const { tasks, truncated } = await getTasksInListPaged(access.token, client.clickupListId, true);
          const byStatus = new Map<string, { status: string; color: string | null; count: number }>();
          for (const task of tasks) {
            const key = task.status ?? 'sem status';
            const entry = byStatus.get(key) ?? { status: key, color: task.statusColor, count: 0 };
            entry.count += 1;
            byStatus.set(key, entry);
          }
          clickup = {
            total_tasks: tasks.length,
            counts_truncated: truncated,
            open_tasks: tasks.filter((task) => task.statusType !== 'closed' && task.statusType !== 'done').length,
            by_status: [...byStatus.values()].sort((a, b) => b.count - a.count),
            latest_comments: (await fetchAggregatedComments(tasks, { apiKey: access.token, teamId: access.teamId })).slice(0, 5),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error({ error, clientId }, 'Falha ao montar resumo do ClickUp');
          reply.code(502);
          return { error: message };
        }
      }

      return {
        clickup,
        conversations: {
          total: conversationCountRow[0]?.value ?? 0,
          latest: recentConversations.map((row) => ({ id: row.id, title: row.title, status: row.status, updated_at: row.updatedAt.toISOString() })),
        },
        studio: {
          total: assetCountRow[0]?.value ?? 0,
          latest: recentAssets.map((row) => ({ id: row.id, type: row.type, filename: row.filename, storage_url: row.storageUrl, created_at: row.createdAt.toISOString() })),
        },
      };
    },
  );

  /**
   * Meta Ads POR CLIENTE (§34-38 do prompt de refinamento "FINAL PRODUCT
   * REFINEMENT", 06/10/2026). REGRA FUNDAMENTAL: mídia é sempre vinculada a
   * UM cliente — toda query aqui embaixo filtra por `clientId`, nunca lista
   * contas de um cliente ao consultar outro, mesmo que o mesmo login Meta
   * enxergue os dois (isso é o que a auditoria de isolamento em
   * meta-accounts.test.ts prova).
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/meta-accounts',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('meta_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const rows = await db.select().from(schema.clientMetaAccounts).where(eq(schema.clientMetaAccounts.clientId, clientId));
      return {
        accounts: rows.map((row) => ({
          account_id: row.accountId,
          business_id: row.businessId,
          is_primary: row.isPrimary,
          label: row.label,
          connected: row.connectionId !== null,
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  );

  /**
   * Vincula uma Ad Account (já visível pela conexão Meta de QUEM está
   * chamando) a este cliente. Valida contra a Graph API antes de gravar —
   * nunca aceita um `account_id` que a conexão da pessoa não enxerga de
   * verdade, pra não criar um vínculo que a tela promete e a API nunca
   * confirma (regra geral do prompt: "não inventar dado").
   */
  app.post<{ Params: { id: string } }>(
    '/clients/:id/meta-accounts',
    { preHandler: [requireAuth, requirePermission('clients', 'write'), requireModule('meta_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const body = linkMetaAccountSchema.safeParse(request.body);
      if (!body.success) {
        reply.code(400);
        return { error: body.error.issues.map((i) => i.message).join(' ') };
      }

      const access = await resolveMetaAccess(request.authUser.id);
      if (!access) {
        reply.code(409);
        return { error: 'Conecte o Meta em Integrações antes de vincular uma conta a este cliente.' };
      }

      let accessible: Awaited<ReturnType<typeof getMetaAdAccounts>>;
      try {
        accessible = await getMetaAdAccounts(access.token, body.data.business_id);
      } catch (error) {
        logger.error({ error, clientId }, 'Falha ao confirmar Ad Account no Meta antes de vincular');
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Meta ad accounts lookup failed' };
      }

      const match = accessible.find((account) => account.id === body.data.account_id);
      if (!match) {
        reply.code(400);
        return { error: `A conta "${body.data.account_id}" não está entre as contas acessíveis pela sua conexão Meta.` };
      }

      // Primary é exclusivo por cliente: marcar uma nova como primária
      // aposenta a anterior, em vez de deixar duas (o schema documenta esse
      // estado como ambíguo e resolvido só na aplicação).
      if (body.data.is_primary) {
        await db
          .update(schema.clientMetaAccounts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(eq(schema.clientMetaAccounts.clientId, clientId));
      }

      await db
        .insert(schema.clientMetaAccounts)
        .values({
          clientId,
          accountId: match.id,
          businessId: match.businessId,
          connectionId: access.connectionId,
          isPrimary: body.data.is_primary ?? false,
          label: body.data.label ?? match.name ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.clientMetaAccounts.clientId, schema.clientMetaAccounts.accountId],
          set: {
            businessId: match.businessId,
            connectionId: access.connectionId,
            isPrimary: body.data.is_primary ?? false,
            label: body.data.label ?? match.name ?? null,
            updatedAt: new Date(),
          },
        });

      await auditarAcao(request, { action: 'client.meta_account_linked', clientId, metadata: { account_id: match.id } });

      return reply.code(201).send({
        account_id: match.id,
        business_id: match.businessId,
        is_primary: body.data.is_primary ?? false,
        label: body.data.label ?? match.name ?? null,
        connected: true,
      });
    },
  );

  app.delete<{ Params: { id: string; accountId: string } }>(
    '/clients/:id/meta-accounts/:accountId',
    { preHandler: [requireAuth, requirePermission('clients', 'write'), requireModule('meta_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const removed = await db
        .delete(schema.clientMetaAccounts)
        .where(and(eq(schema.clientMetaAccounts.clientId, clientId), eq(schema.clientMetaAccounts.accountId, request.params.accountId)))
        .returning({ id: schema.clientMetaAccounts.id });

      if (removed.length === 0) {
        reply.code(404);
        return { error: 'Meta account mapping not found for this client' };
      }

      await auditarAcao(request, { action: 'client.meta_account_unlinked', clientId, metadata: { account_id: request.params.accountId } });
      return { ok: true };
    },
  );

  /**
   * Resumo de mídia (§39): usa a conexão GRAVADA no vínculo
   * (`resolveMetaAccessByConnectionId`), não a de quem está olhando agora —
   * ver comentário na função. Sem vínculo nenhum, devolve `connected: false`
   * em vez de 404: é um estado normal e esperado de cliente sem mídia
   * conectada ainda (regra "sem fake UI": a tela mostra "Meta Ads não
   * conectado" a partir deste campo, nunca número inventado).
   */
  /**
   * ─── A CARTEIRA INTEIRA DE MÍDIA, numa resposta ───────────────────────
   *
   * A tela de Mídias pergunta algo que nenhuma rota respondia: "como está a
   * mídia de TODOS os meus clientes agora?". O que existia era `summary` por
   * cliente — bom para a ficha, inútil para quem cuida de tráfego e precisa
   * varrer a carteira de manhã sem abrir vinte abas.
   *
   * O RECORTE É O MESMO da listagem de clientes: `requireTenant` decide a
   * empresa de trabalho e só os clientes DELA entram. Não se agrega por "todos
   * os clientes que eu enxergo" — provedor enxerga a carteira de vários
   * tenants, e misturar isso num total seria somar dinheiro de empresas
   * diferentes na mesma linha.
   *
   * CLIENTE SEM VÍNCULO APARECE. Ele é metade do valor da tela: é a lista do
   * que falta conectar. Vem com `connected: false`, nunca omitido.
   *
   * Uma credencial por CONEXÃO, resolvida uma vez e reaproveitada entre os
   * clientes que a compartilham — senão uma carteira de 50 clientes faria 50
   * resoluções idênticas antes da primeira chamada ao Meta.
   */
  app.get(
    '/media/overview',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('meta_ads')] },
    async (request, reply) => {
      await requireTenant(request, reply);
      if (reply.sent) return;

      const clientes = await db
        .select({ id: schema.clients.id, name: schema.clients.name, status: schema.clients.status })
        .from(schema.clients)
        .where(eq(schema.clients.organizationId, request.tenantContext!.organizationId))
        .orderBy(asc(schema.clients.name));

      if (clientes.length === 0) return { clients: [] };

      const vinculos = await db
        .select({
          clientId: schema.clientMetaAccounts.clientId,
          accountId: schema.clientMetaAccounts.accountId,
          connectionId: schema.clientMetaAccounts.connectionId,
          label: schema.clientMetaAccounts.label,
          isPrimary: schema.clientMetaAccounts.isPrimary,
        })
        .from(schema.clientMetaAccounts)
        .orderBy(desc(schema.clientMetaAccounts.isPrimary), asc(schema.clientMetaAccounts.createdAt));

      const vinculoPorCliente = new Map<string, (typeof vinculos)[number]>();
      for (const v of vinculos) if (!vinculoPorCliente.has(v.clientId)) vinculoPorCliente.set(v.clientId, v);

      // Uma resolução por conexão, não por cliente.
      const acessoPorConexao = new Map<string, Awaited<ReturnType<typeof resolveMetaAccessByConnectionId>>>();
      for (const v of vinculoPorCliente.values()) {
        if (v.connectionId && !acessoPorConexao.has(v.connectionId)) {
          acessoPorConexao.set(v.connectionId, await resolveMetaAccessByConnectionId(v.connectionId));
        }
      }

      const linhas = await Promise.all(
        clientes.map(async (cliente) => {
          const base = { client_id: cliente.id, client_name: cliente.name, status: cliente.status };
          const vinculo = vinculoPorCliente.get(cliente.id);
          if (!vinculo) return { ...base, connected: false as const };

          const acesso = vinculo.connectionId ? acessoPorConexao.get(vinculo.connectionId) : null;
          if (!acesso) {
            return {
              ...base,
              connected: true as const,
              account_id: vinculo.accountId,
              account_label: vinculo.label,
              data_available: false as const,
              reason: 'Vínculo sem conexão OAuth válida, reconecte o Meta em Integrações.',
            };
          }

          try {
            const insights = await getMetaAccountInsights(acesso.token, vinculo.accountId, 'last_30d');
            return {
              ...base,
              connected: true as const,
              account_id: vinculo.accountId,
              account_label: vinculo.label,
              data_available: true as const,
              insights,
            };
          } catch (erro) {
            // Um cliente com a API fora não pode apagar a carteira inteira.
            logger.warn({ erro, clientId: cliente.id }, 'Falha ao ler insights do Meta para a visão de mídia');
            return {
              ...base,
              connected: true as const,
              account_id: vinculo.accountId,
              account_label: vinculo.label,
              data_available: false as const,
              reason: 'O Meta não respondeu agora. O número existe, só não deu para ler.',
            };
          }
        }),
      );

      return { clients: linhas };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { date_preset?: string } }>(
    '/clients/:id/media/meta/summary',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('meta_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [mapping] = await db
        .select()
        .from(schema.clientMetaAccounts)
        .where(eq(schema.clientMetaAccounts.clientId, clientId))
        .orderBy(desc(schema.clientMetaAccounts.isPrimary), asc(schema.clientMetaAccounts.createdAt))
        .limit(1);

      if (!mapping) return { connected: false };

      if (!mapping.connectionId) {
        return { connected: true, account_id: mapping.accountId, data_available: false, reason: 'Vínculo sem conexão OAuth associada, reconecte o Meta.' };
      }

      const access = await resolveMetaAccessByConnectionId(mapping.connectionId);
      if (!access) {
        return { connected: true, account_id: mapping.accountId, data_available: false, reason: 'A conexão Meta usada neste vínculo foi desconectada ou expirou.' };
      }

      const datePreset = request.query.date_preset ?? 'last_30d';
      try {
        const [insights, campaigns] = await Promise.all([
          getMetaAccountInsights(access.token, mapping.accountId, datePreset),
          getMetaCampaigns(access.token, mapping.accountId, datePreset),
        ]);
        return {
          connected: true,
          account_id: mapping.accountId,
          data_available: true,
          // snake_case no wire (convenção do resto da API) — o retorno de
          // getMetaAccountInsights é camelCase porque é TS interno do tool-gateway.
          insights: insights && {
            spend: insights.spend,
            impressions: insights.impressions,
            clicks: insights.clicks,
            ctr: insights.ctr,
            cpc: insights.cpc,
            cpm: insights.cpm,
            frequency: insights.frequency,
            results: insights.results,
            period_start: insights.periodStart,
            period_end: insights.periodEnd,
          },
          campaigns,
        };
      } catch (error) {
        logger.error({ error, clientId }, 'Falha ao buscar dados de mídia Meta do cliente');
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Meta data lookup failed' };
      }
    },
  );

  /**
   * Google Ads POR CLIENTE (§43-45 do prompt de refinamento). MESMA regra
   * fundamental do Meta: "3Net usa somente o Customer ID da 3Net" — todo
   * acesso aqui embaixo é filtrado por clientId primeiro, nunca por login.
   */
  app.get<{ Params: { id: string } }>(
    '/clients/:id/google-ads-accounts',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('google_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const rows = await db.select().from(schema.clientGoogleAdsAccounts).where(eq(schema.clientGoogleAdsAccounts.clientId, clientId));
      return {
        accounts: rows.map((row) => ({
          customer_id: row.customerId,
          login_customer_id: row.loginCustomerId,
          is_primary: row.isPrimary,
          label: row.label,
          connected: row.connectionId !== null,
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/clients/:id/google-ads-accounts',
    { preHandler: [requireAuth, requirePermission('clients', 'write'), requireModule('google_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const body = linkGoogleAdsAccountSchema.safeParse(request.body);
      if (!body.success) {
        reply.code(400);
        return { error: body.error.issues.map((i) => i.message).join(' ') };
      }

      const access = await resolveGoogleAdsAccess(request.authUser.id);
      if (!access) {
        reply.code(409);
        return { error: 'Conecte o Google Ads em Integrações antes de vincular uma conta a este cliente.' };
      }

      let accessible: Awaited<ReturnType<typeof getGoogleAdsAccounts>>;
      try {
        const config = body.data.login_customer_id ? { ...access.config, loginCustomerId: body.data.login_customer_id } : access.config;
        accessible = await getGoogleAdsAccounts(config, access.accessToken, body.data.login_customer_id);
      } catch (error) {
        logger.error({ error, clientId }, 'Falha ao confirmar Customer ID no Google Ads antes de vincular');
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Google Ads accounts lookup failed' };
      }

      const match = accessible.find((account) => account.customerId === body.data.customer_id);
      if (!match) {
        reply.code(400);
        return { error: `A conta "${body.data.customer_id}" não está entre as contas acessíveis pela sua conexão Google Ads.` };
      }

      if (body.data.is_primary) {
        await db
          .update(schema.clientGoogleAdsAccounts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(eq(schema.clientGoogleAdsAccounts.clientId, clientId));
      }

      await db
        .insert(schema.clientGoogleAdsAccounts)
        .values({
          clientId,
          customerId: match.customerId,
          loginCustomerId: match.managerCustomerId ?? body.data.login_customer_id ?? null,
          connectionId: access.connectionId,
          isPrimary: body.data.is_primary ?? false,
          label: body.data.label ?? match.descriptiveName ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.clientGoogleAdsAccounts.clientId, schema.clientGoogleAdsAccounts.customerId],
          set: {
            loginCustomerId: match.managerCustomerId ?? body.data.login_customer_id ?? null,
            connectionId: access.connectionId,
            isPrimary: body.data.is_primary ?? false,
            label: body.data.label ?? match.descriptiveName ?? null,
            updatedAt: new Date(),
          },
        });

      await auditarAcao(request, { action: 'client.google_ads_account_linked', clientId, metadata: { customer_id: match.customerId } });

      return reply.code(201).send({
        customer_id: match.customerId,
        login_customer_id: match.managerCustomerId ?? body.data.login_customer_id ?? null,
        is_primary: body.data.is_primary ?? false,
        label: body.data.label ?? match.descriptiveName ?? null,
        connected: true,
      });
    },
  );

  app.delete<{ Params: { id: string; customerId: string } }>(
    '/clients/:id/google-ads-accounts/:customerId',
    { preHandler: [requireAuth, requirePermission('clients', 'write'), requireModule('google_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const removed = await db
        .delete(schema.clientGoogleAdsAccounts)
        .where(and(eq(schema.clientGoogleAdsAccounts.clientId, clientId), eq(schema.clientGoogleAdsAccounts.customerId, request.params.customerId)))
        .returning({ id: schema.clientGoogleAdsAccounts.id });

      if (removed.length === 0) {
        reply.code(404);
        return { error: 'Google Ads account mapping not found for this client' };
      }

      await auditarAcao(request, { action: 'client.google_ads_account_unlinked', clientId, metadata: { customer_id: request.params.customerId } });
      return { ok: true };
    },
  );

  /**
   * OS CRIATIVOS DO CLIENTE — o que a peça É, não só quanto ela gastou.
   *
   * Até aqui mídia parava em campanha. Quem cuida de tráfego decide pelo
   * criativo: qual arte rodou, qual parou de performar, qual repetir. E o
   * cartão de conexão do produto já prometia "campanhas, criativos e
   * resultados" antes de existir qualquer leitura de criativo — esta rota é o
   * que torna aquela frase verdadeira.
   *
   * Mesmos três gates das rotas irmãs e o MESMO union honesto de estados:
   * sem vínculo, vínculo sem conexão, conexão morta, e dado de verdade. Imagem
   * de criativo que não veio é `null`, nunca uma caixa cinza fingindo peça.
   */
  app.get<{ Params: { id: string }; Querystring: { date_preset?: string } }>(
    '/clients/:id/media/meta/creatives',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('meta_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [mapping] = await db
        .select()
        .from(schema.clientMetaAccounts)
        .where(eq(schema.clientMetaAccounts.clientId, clientId))
        .orderBy(desc(schema.clientMetaAccounts.isPrimary), asc(schema.clientMetaAccounts.createdAt))
        .limit(1);

      if (!mapping) return { connected: false };
      if (!mapping.connectionId) {
        return { connected: true, account_id: mapping.accountId, data_available: false, reason: 'Vínculo sem conexão OAuth associada, reconecte o Meta.' };
      }

      const access = await resolveMetaAccessByConnectionId(mapping.connectionId);
      if (!access) {
        return { connected: true, account_id: mapping.accountId, data_available: false, reason: 'A conexão Meta usada neste vínculo foi desconectada ou expirou.' };
      }

      try {
        const ads = await getMetaAds(access.token, mapping.accountId, request.query.date_preset ?? 'last_30d');
        return {
          connected: true,
          account_id: mapping.accountId,
          data_available: true,
          creatives: ads.map((ad) => ({
            id: ad.id,
            name: ad.name,
            status: ad.status,
            thumbnail_url: ad.thumbnailUrl,
            image_url: ad.imageUrl,
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            ctr: ad.ctr,
          })),
        };
      } catch (error) {
        logger.error({ error, clientId }, 'Falha ao buscar criativos do Meta');
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Meta creatives lookup failed' };
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { date_range?: string } }>(
    '/clients/:id/media/google-ads/summary',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('google_ads')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [mapping] = await db
        .select()
        .from(schema.clientGoogleAdsAccounts)
        .where(eq(schema.clientGoogleAdsAccounts.clientId, clientId))
        .orderBy(desc(schema.clientGoogleAdsAccounts.isPrimary), asc(schema.clientGoogleAdsAccounts.createdAt))
        .limit(1);

      if (!mapping) return { connected: false };

      if (!mapping.connectionId) {
        return { connected: true, customer_id: mapping.customerId, data_available: false, reason: 'Vínculo sem conexão OAuth associada, reconecte o Google Ads.' };
      }

      const access = await resolveGoogleAdsAccessByConnectionId(mapping.connectionId);
      if (!access) {
        return { connected: true, customer_id: mapping.customerId, data_available: false, reason: 'A conexão Google Ads usada neste vínculo foi desconectada ou expirou.' };
      }

      const envConfig = getGoogleAdsEnvConfig();
      if (!envConfig) {
        return { connected: true, customer_id: mapping.customerId, data_available: false, reason: 'Google Ads não está configurado no Orchestrator.' };
      }
      const config = mapping.loginCustomerId ? { ...envConfig, loginCustomerId: mapping.loginCustomerId } : envConfig;

      const dateRange = request.query.date_range ?? 'LAST_30_DAYS';
      try {
        const [insights, campaigns] = await Promise.all([
          getGoogleAdsAccountInsights(config, access.accessToken, mapping.customerId, dateRange),
          getGoogleAdsCampaigns(config, access.accessToken, mapping.customerId, dateRange),
        ]);
        return {
          connected: true,
          customer_id: mapping.customerId,
          data_available: true,
          insights: insights && {
            spend: insights.spend,
            impressions: insights.impressions,
            clicks: insights.clicks,
            ctr: insights.ctr,
            average_cpc: insights.averageCpc,
            conversions: insights.conversions,
            conversions_value: insights.conversionsValue,
          },
          campaigns,
        };
      } catch (error) {
        logger.error({ error, clientId }, 'Falha ao buscar dados de mídia Google Ads do cliente');
        reply.code(502);
        return { error: error instanceof Error ? error.message : 'Google Ads data lookup failed' };
      }
    },
  );

  /**
   * Relatórios PDF (§46-51 do prompt de refinamento). ASSÍNCRONO: a rota só
   * cria a linha e enfileira — o worker busca os dados, renderiza o PDF e
   * sobe pro Storage (ver apps/worker/src/processors/generate-client-report.ts).
   * Front-end faz polling de GET /clients/:id/reports/:reportId até
   * status='ready' (ou 'failed'), mesmo padrão de motion_sessions.
   */
  app.post<{ Params: { id: string } }>(
    '/clients/:id/reports',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('relatorios')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const body = reportRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: body.error.issues.map((i) => i.message).join(' ') };
      }

      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - body.data.period_days * 24 * 60 * 60 * 1000);

      const [created] = await db
        .insert(schema.clientReports)
        .values({
          organizationId: request.tenantContext!.organizationId,
          clientId,
          requestedBy: request.authUser.id,
          channels: body.data.channels,
          periodDays: body.data.period_days,
          periodStart,
          periodEnd,
        })
        .returning();

      await enqueueClientReport(created!.id);
      await auditarAcao(request, { action: 'client.report_requested', clientId, metadata: { channels: body.data.channels, period_days: body.data.period_days } });

      reply.code(202);
      return apresentacaoDoRelatorio(created!);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/clients/:id/reports',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('relatorios')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const rows = await db
        .select()
        .from(schema.clientReports)
        .where(eq(schema.clientReports.clientId, clientId))
        .orderBy(desc(schema.clientReports.createdAt))
        .limit(20);

      return { reports: rows.map(apresentacaoDoRelatorio) };
    },
  );

  app.get<{ Params: { id: string; reportId: string } }>(
    '/clients/:id/reports/:reportId',
    { preHandler: [requireAuth, requirePermission('clients', 'read'), requireModule('relatorios')] },
    async (request, reply) => {
      const clientId = request.params.id;
      if (!request.authUser || !(await hasClientAccess(request.authUser, clientId))) {
        reply.code(403);
        return { error: 'No access granted to this client' };
      }

      const [row] = await db
        .select()
        .from(schema.clientReports)
        .where(and(eq(schema.clientReports.id, request.params.reportId), eq(schema.clientReports.clientId, clientId)));

      if (!row) {
        reply.code(404);
        return { error: 'Report not found for this client' };
      }
      return apresentacaoDoRelatorio(row);
    },
  );
}
