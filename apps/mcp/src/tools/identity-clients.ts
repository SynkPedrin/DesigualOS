import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { ehCitavel, scopesDoPapel, type McpPrincipal } from '@desigual-os/mcp-domain';
import { registrarTool, type RegistrarToolDeps } from './kit.js';

/**
 * identity-clients.ts — quem sou eu, o que posso, e o que sei sobre um cliente.
 *
 * As tools de identidade existem por um motivo de produto, não de protocolo: o
 * Claude precisa saber com QUEM está falando para não prometer o que aquela
 * pessoa não pode fazer. Sem isso ele oferece "posso criar a task para você" a
 * um VIEWER e a recusa só aparece depois, como erro.
 */

export function registrarToolsDeIdentidadeEClientes(deps: RegistrarToolDeps): void {
  registrarTool(deps, {
    nome: 'get_current_user',
    descricao:
      'Quem é o funcionário que está falando com você agora: nome, e-mail, papel na agência e organização. ' +
      'Chame no início de uma conversa de trabalho para saber o que essa pessoa pode e não pode fazer.',
    entrada: {},
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'user',
    executar: async (_args, ctx) => ({
      user_id: ctx.principal.userId,
      employee_id: ctx.principal.employeeId,
      name: ctx.principal.name,
      email: ctx.principal.email,
      role: ctx.principal.role,
      organization_id: ctx.principal.organizationId,
    }),
  });

  registrarTool(deps, {
    nome: 'get_current_permissions',
    descricao:
      'O que esta pessoa pode fazer pelo Desigual OS: scopes efetivos e o teto do papel dela. ' +
      'Use antes de oferecer uma ação de escrita, para não prometer o que vai ser recusado.',
    entrada: {},
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'permissions',
    executar: async (_args, ctx) => ({
      role: ctx.principal.role,
      /** O efetivo já é a interseção token ∩ papel — é o que de fato vale. */
      effective_scopes: ctx.principal.scopes,
      role_ceiling: scopesDoPapel(ctx.principal.role),
      can_write_tasks: ctx.principal.scopes.includes('tasks.write'),
      can_write_clients: ctx.principal.scopes.includes('clients.write'),
      can_read_traffic: ctx.principal.scopes.includes('traffic.read'),
    }),
  });

  registrarTool(deps, {
    nome: 'get_current_organization',
    descricao: 'A organização (agência) a que este funcionário pertence, e o tamanho da carteira dela.',
    entrada: {},
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'organization',
    executar: async (_args, ctx) => {
      const [org] = await db
        .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, ctx.principal.organizationId));
      const [contagem] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.clients)
        .where(and(eq(schema.clients.organizationId, ctx.principal.organizationId), isNull(schema.clients.deletedAt)));
      return { ...org, active_clients: contagem?.n ?? 0 };
    },
  });

  registrarTool(deps, {
    nome: 'search_clients',
    descricao:
      'Procura clientes da agência pelo nome. Devolve só os clientes da organização desta pessoa. ' +
      'Use para resolver o nome que o funcionário falou ("o cliente da clínica") no cliente real antes de qualquer outra coisa.',
    entrada: {
      query: z.string().min(1).describe('Parte do nome do cliente. Não precisa ser exato.'),
      limit: z.number().int().min(1).max(50).optional().describe('Quantos devolver. Padrão 10.'),
    },
    scope: 'clients.read',
    acesso: 'READ',
    recurso: 'client',
    executar: async (args, ctx) => {
      const linhas = await db
        .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
        .from(schema.clients)
        .where(
          and(
            eq(schema.clients.organizationId, ctx.principal.organizationId),
            isNull(schema.clients.deletedAt),
            ilike(schema.clients.name, `%${args.query}%`),
          ),
        )
        .limit(args.limit ?? 10);
      return {
        clients: linhas.map((c) => ({
          client_id: c.id,
          name: c.name,
          /**
           * Cliente sem lista do ClickUp é um buraco REAL da operação (seis
           * deles em 29/09/2026, John Deere entre eles) e o Claude precisa
           * saber: pedir tarefas desse cliente vai voltar vazio, e vazio não
           * significa "não há trabalho".
           */
          has_task_tracking: Boolean(c.listId),
        })),
        count: linhas.length,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_client_context',
    descricao:
      'O RESUMO OPERACIONAL de um cliente, pronto para trabalhar: quem é, o que está aberto, o que está atrasado, ' +
      'e o que a agência já aprendeu sobre ele. É a primeira chamada antes de criar qualquer peça para esse cliente.',
    entrada: {
      client_id: z.string().uuid().describe('Id do cliente. Use search_clients se só tiver o nome.'),
      include_memory: z.boolean().optional().describe('Trazer decisões e preferências registradas. Padrão true.'),
    },
    scope: 'clients.read',
    acesso: 'READ',
    recurso: 'client',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const contexto: Record<string, unknown> = {
        client_id: cliente.id,
        name: cliente.name,
        has_task_tracking: Boolean(cliente.clickupListId),
      };

      if (args.include_memory !== false && ctx.principal.scopes.includes('memory.read')) {
        const memorias = await db
          .select({
            id: schema.memories.id, kind: schema.memories.kind, content: schema.memories.content,
            status: schema.memories.status, confidence: schema.memories.confidence,
            sourceType: schema.memories.sourceType, updatedAt: schema.memories.updatedAt,
          })
          .from(schema.memories)
          .where(and(eq(schema.memories.clientId, cliente.id), eq(schema.memories.status, 'active')))
          .orderBy(desc(schema.memories.updatedAt))
          .limit(8);
        contexto.memory = memorias.map((m) => ({
          kind: m.kind,
          // §19: resumo, não despejo. O dossiê inteiro tem milhares de chars.
          excerpt: m.content.slice(0, 600),
          source: m.sourceType,
          confidence: m.confidence,
          updated_at: m.updatedAt,
        }));
      }

      const eventos = await db
        .select({
          type: schema.operationalEvents.type, summary: schema.operationalEvents.summary,
          occurredAt: schema.operationalEvents.occurredAt, importance: schema.operationalEvents.importance,
        })
        .from(schema.operationalEvents)
        .where(eq(schema.operationalEvents.clientId, cliente.id))
        .orderBy(desc(schema.operationalEvents.occurredAt))
        .limit(10);
      contexto.recent_events = eventos.map((e) => ({
        type: e.type, summary: e.summary, at: e.occurredAt, importance: e.importance,
      }));

      if (cliente.clickupListId) {
        const pagina = await ctx.providers.tasks.searchTasks({ clientIds: [cliente.id], limit: 15 });
        const agora = Date.now();
        contexto.open_tasks = pagina.tasks.length;
        contexto.overdue_tasks = pagina.tasks.filter((t) => t.dueDate !== null && t.dueDate < agora).length;
        contexto.unassigned_tasks = pagina.tasks.filter((t) => t.assignees.length === 0).length;
        contexto.tasks = pagina.tasks.map(resumoDeTask);
        contexto.tasks_truncated = pagina.truncated;
      } else {
        contexto.tasks_note = 'Este cliente não tem lista do ClickUp vinculada: não há tarefas para consultar. Ausência aqui NÃO significa ausência de trabalho.';
      }
      return contexto;
    },
  });

  registrarTool(deps, {
    nome: 'get_client_recent_events',
    descricao:
      'O que aconteceu com este cliente recentemente, na ordem em que aconteceu. ' +
      'Responde "o que foi feito para o cliente X essa semana?" — inclusive trabalho registrado por OUTROS funcionários.',
    entrada: {
      client_id: z.string().uuid(),
      days: z.number().int().min(1).max(90).optional().describe('Janela em dias. Padrão 7.'),
      limit: z.number().int().min(1).max(100).optional(),
    },
    scope: 'clients.read',
    acesso: 'READ',
    recurso: 'client_events',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const desde = new Date(Date.now() - (args.days ?? 7) * 86_400_000);
      const eventos = await db
        .select({
          type: schema.operationalEvents.type, summary: schema.operationalEvents.summary,
          occurredAt: schema.operationalEvents.occurredAt, actor: schema.operationalEvents.actor,
          importance: schema.operationalEvents.importance, source: schema.operationalEvents.source,
        })
        .from(schema.operationalEvents)
        .where(
          and(
            eq(schema.operationalEvents.clientId, cliente.id),
            sql`coalesce(${schema.operationalEvents.occurredAt}, ${schema.operationalEvents.createdAt}) >= ${desde.toISOString()}`,
            // Evento privado de outra pessoa não aparece para colegas.
            or(
              sql`${schema.operationalEvents.visibility} <> 'PRIVATE'`,
              eq(schema.operationalEvents.userId, ctx.principal.userId),
            ),
          ),
        )
        .orderBy(desc(schema.operationalEvents.occurredAt))
        .limit(args.limit ?? 30);
      return {
        client: cliente.name,
        window_days: args.days ?? 7,
        events: eventos.map((e) => ({
          type: e.type, summary: e.summary, at: e.occurredAt, by: e.actor, importance: e.importance, source: e.source,
        })),
        count: eventos.length,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_client_preferences',
    descricao:
      'O que a agência já aprendeu sobre como este cliente gosta de ser atendido: preferências, restrições e vetos. ' +
      'Cada item vem com a procedência e uma ressalva quando não foi confirmado — respeite a ressalva.',
    entrada: { client_id: z.string().uuid() },
    scope: 'memory.read',
    acesso: 'READ',
    recurso: 'client_preferences',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const linhas = await db
        .select({
          content: schema.memories.content, kind: schema.memories.kind, status: schema.memories.status,
          confidence: schema.memories.confidence, sourceType: schema.memories.sourceType,
          updatedAt: schema.memories.updatedAt,
        })
        .from(schema.memories)
        .where(
          and(
            eq(schema.memories.clientId, cliente.id),
            eq(schema.memories.status, 'active'),
            or(
              ilike(schema.memories.kind, '%preference%'),
              ilike(schema.memories.kind, '%feedback%'),
              ilike(schema.memories.kind, '%aprendizado%'),
            ),
          ),
        )
        .orderBy(desc(schema.memories.updatedAt))
        .limit(20);
      return {
        client: cliente.name,
        preferences: linhas.map((m) => {
          const { ressalva } = ehCitavel({ status: 'OBSERVED' });
          return {
            kind: m.kind,
            content: m.content.slice(0, 800),
            source: m.sourceType,
            confidence: m.confidence,
            /**
             * A ressalva viaja JUNTO com o conteúdo, sempre. Separar os dois é
             * o caminho mais curto para o Claude citar um relato não confirmado
             * como se fosse política da agência.
             */
            caveat: ressalva,
            updated_at: m.updatedAt,
          };
        }),
        count: linhas.length,
      };
    },
  });
}

/** Carrega o cliente JÁ conferindo a fronteira de organização. Lança se for de fora. */
export async function carregarClienteDaOrganizacao(
  principal: McpPrincipal,
  clientId: string,
): Promise<{ id: string; name: string; clickupListId: string | null }> {
  const [cliente] = await db
    .select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.id, clientId),
        // A fronteira vive NA QUERY, não num `if` depois — é o que impede
        // uma tool nova de esquecer de aplicá-la.
        eq(schema.clients.organizationId, principal.organizationId),
        isNull(schema.clients.deletedAt),
      ),
    );
  if (!cliente) throw new Error('Não encontrei esse cliente.');
  return cliente;
}

/** Resumo de task pensado para caber em contexto (§19). */
export function resumoDeTask(t: {
  id: string; title: string; status: string | null; dueDate: number | null;
  assignees: string[]; priority: string | null; url: string | null; clientName: string | null;
}): Record<string, unknown> {
  return {
    task_id: t.id,
    title: t.title,
    status: t.status,
    client: t.clientName,
    due: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : null,
    overdue: t.dueDate !== null && t.dueDate < Date.now(),
    assignees: t.assignees,
    priority: t.priority,
    url: t.url,
  };
}
