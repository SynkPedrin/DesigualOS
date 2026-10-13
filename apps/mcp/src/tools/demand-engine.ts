import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao } from './identity-clients.js';

/**
 * demand-engine.ts — Bento conectado ao core workflow CLIENTE→CONVERSA→
 * DEMANDA→BRIEFING→APROVAÇÃO (P1, 06/10/2026), conexão PROGRESSIVA: só
 * leitura nesta rodada. Criar task a partir de brief aprovado e resolver
 * aprovação pelo chat ficam para a próxima rodada — registrado como
 * KNOWN LIMITATION no progress doc, não esquecido.
 *
 * NOME NUNCA CONFUNDE COM O QUE JÁ EXISTE: `get_approvals` (v2.ts) é
 * heurística de TEXTO sobre status de task do ClickUp ("aprovação",
 * "revisão" no nome do status) — outro dado, outra tabela. Aqui é
 * `approval_requests`, a fila de negócio (brief/peça/campanha) do P1-I.
 * Nenhuma tool aqui lê nem escreve a fila do ClickUp.
 *
 * `scope: 'tasks.read'` reaproveitado de propósito — mesmo scope que já
 * cobre leitura operacional (`get_approvals`, `get_workload`); criar um
 * scope novo só para 3 tools de leitura seria estrutura antes de precisar
 * dela.
 */
export function registrarToolsDeDemanda(deps: RegistrarToolDeps): void {
  registrarTool(deps, {
    nome: 'get_demands',
    descricao:
      'O que foi pedido pelos clientes e em que pé está — do pedido inicial ao briefing aprovado ' +
      '(status: new, briefing, in_production, done, cancelled). Distinto de task do ClickUp: uma demanda pode ' +
      'ainda não ter virado task nenhuma. Use para responder "o que o cliente X pediu" ou "o que está parado em briefing".',
    entrada: {
      client_id: z.string().uuid().optional(),
      status: z.enum(['new', 'briefing', 'in_production', 'done', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'demand',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const condicoes = [eq(schema.demands.organizationId, ctx.principal.organizationId)];
      if (args.client_id) condicoes.push(eq(schema.demands.clientId, args.client_id));
      if (args.status) condicoes.push(eq(schema.demands.status, args.status));

      const linhas = await db
        .select({
          id: schema.demands.id, title: schema.demands.title, status: schema.demands.status,
          priority: schema.demands.priority, source: schema.demands.source,
          requestedAt: schema.demands.requestedAt, dueDate: schema.demands.dueDate,
          clientName: schema.clients.name,
        })
        .from(schema.demands)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.demands.clientId))
        .where(and(...condicoes))
        .orderBy(desc(schema.demands.requestedAt))
        .limit(args.limit ?? 25);

      return {
        count: linhas.length,
        demands: linhas.map((d) => ({
          demand_id: d.id, title: d.title, client: d.clientName, status: d.status,
          priority: d.priority, source: d.source,
          requested_at: d.requestedAt.toISOString(),
          due_date: d.dueDate?.toISOString() ?? null,
        })),
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_demand_brief_status',
    descricao:
      'O briefing de uma demanda específica: status, quantas versões, qual foi a aprovada (se houver), e se já ' +
      'virou task de produção. Use depois de get_demands quando a pessoa perguntar sobre UMA demanda específica ' +
      '("como está o briefing da campanha de outubro do Instituto Almada").',
    entrada: { demand_id: z.string().uuid() },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'brief',
    executar: async (args, ctx) => {
      const [demanda] = await db
        .select({ id: schema.demands.id, title: schema.demands.title, organizationId: schema.demands.organizationId })
        .from(schema.demands)
        .where(and(eq(schema.demands.id, args.demand_id), eq(schema.demands.organizationId, ctx.principal.organizationId)));
      if (!demanda) {
        return { found: false, message: `Demanda '${args.demand_id}' não encontrada nesta organização.` };
      }

      const briefs = await db
        .select({
          id: schema.briefs.id, status: schema.briefs.status, approvedVersionId: schema.briefs.approvedVersionId,
          externalTaskId: schema.briefs.externalTaskId, externalTaskProvider: schema.briefs.externalTaskProvider,
        })
        .from(schema.briefs)
        .where(eq(schema.briefs.demandId, args.demand_id));

      if (briefs.length === 0) {
        return { found: true, demand_title: demanda.title, has_brief: false, message: 'Esta demanda ainda não tem um briefing criado.' };
      }

      const brief = briefs[0]!;
      const versoes = await db.select({ id: schema.briefVersions.id, version: schema.briefVersions.version })
        .from(schema.briefVersions).where(eq(schema.briefVersions.briefId, brief.id));

      const [aprovacao] = await db
        .select({ status: schema.approvalRequests.status, resolvedAt: schema.approvalRequests.resolvedAt })
        .from(schema.approvalRequests)
        .where(and(eq(schema.approvalRequests.resourceType, 'brief'), eq(schema.approvalRequests.resourceId, brief.id)))
        .orderBy(desc(schema.approvalRequests.createdAt))
        .limit(1);

      return {
        found: true,
        demand_title: demanda.title,
        has_brief: true,
        brief_status: brief.status,
        versions_count: versoes.length,
        has_approved_version: brief.approvedVersionId !== null,
        sent_to_production: brief.externalTaskId !== null,
        external_task_id: brief.externalTaskId,
        external_task_provider: brief.externalTaskProvider,
        approval_status: aprovacao?.status ?? 'not_requested',
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_pending_business_approvals',
    descricao:
      'Fila de aprovação de RECURSO DE NEGÓCIO pendente (briefing, peça, campanha) — não confundir com ' +
      '`get_approvals`, que é heurística de status de task do ClickUp. Use para "o que está esperando aprovação ' +
      'de briefing/peça" ou para cobrar quem precisa decidir.',
    entrada: { client_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'approval_request',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const condicoes = [
        eq(schema.approvalRequests.organizationId, ctx.principal.organizationId),
        eq(schema.approvalRequests.status, 'pending'),
        isNull(schema.approvalRequests.resolvedAt),
      ];
      if (args.client_id) condicoes.push(eq(schema.approvalRequests.clientId, args.client_id));

      const linhas = await db
        .select({
          id: schema.approvalRequests.id, resourceType: schema.approvalRequests.resourceType,
          resourceId: schema.approvalRequests.resourceId, createdAt: schema.approvalRequests.createdAt,
          clientName: schema.clients.name,
        })
        .from(schema.approvalRequests)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.approvalRequests.clientId))
        .where(and(...condicoes))
        .orderBy(desc(schema.approvalRequests.createdAt))
        .limit(args.limit ?? 25);

      return {
        count: linhas.length,
        pending_approvals: linhas.map((a) => ({
          approval_id: a.id, resource_type: a.resourceType, resource_id: a.resourceId,
          client: a.clientName, requested_at: a.createdAt.toISOString(),
        })),
      };
    },
  });
}
