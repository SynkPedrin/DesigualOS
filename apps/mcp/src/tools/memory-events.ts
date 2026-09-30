import { z } from 'zod';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  confiancaInicial, deveRegistrar, ehCitavel, importanciaPadrao, isMcpEventType,
  MCP_EVENT_TYPES, statusInicial, type McpEventType,
} from '@desigual-os/mcp-domain';
import { registrarAuditoria } from '../audit.js';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao, resumoDeTask } from './identity-clients.js';
import { somenteMemoriaVisivelNoMcp } from './visibilidade-de-memoria.js';

/**
 * memory-events.ts — o que transforma o chat individual em memória da empresa.
 *
 * É aqui que mora a proposta de valor do §31: o funcionário continua
 * trabalhando no Claude dele, mas o que ele APRENDE fica com a agência. E é
 * aqui que mora o risco correspondente — memória envenenada por hipótese não
 * confirmada é pior que memória vazia, porque o próximo colega trata como fato.
 *
 * Por isso duas regras que este arquivo aplica sem exceção:
 *   - nada gravado pelo Claude nasce confirmado (§11);
 *   - hipótese e conversa não são gravadas (§10), e o filtro é código, não prompt.
 */

export function registrarToolsDeMemoriaEEventos(deps: RegistrarToolDeps): void {
  registrarTool(deps, {
    nome: 'search_memory',
    descricao:
      'Procura na memória institucional da agência: decisões, aprendizados, preferências de cliente e feedback registrado. ' +
      'Cada resultado vem com procedência e ressalva — se vier ressalva, repasse a ressalva ao funcionário em vez de afirmar como fato.',
    entrada: {
      query: z.string().min(2).describe('O que procurar.'),
      client_id: z.string().uuid().optional().describe('Restringe a um cliente.'),
      limit: z.number().int().min(1).max(30).optional(),
    },
    scope: 'memory.read',
    acesso: 'READ',
    recurso: 'memory',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const condicoes = [
        eq(schema.memories.status, 'active'),
        ilike(schema.memories.content, `%${args.query}%`),
        // ANOTAÇÃO PRIVADA DE OUTRA PESSOA NÃO SAI DAQUI. Ver
        // ./visibilidade-de-memoria.ts: sem esta linha, buscar "privada"
        // devolvia as notas da Tammy para qualquer um da organização.
        somenteMemoriaVisivelNoMcp(ctx.principal.userId),
      ];
      if (args.client_id) condicoes.push(eq(schema.memories.clientId, args.client_id));
      const linhas = await db
        .select({
          id: schema.memories.id, kind: schema.memories.kind, content: schema.memories.content,
          clientId: schema.memories.clientId, sourceType: schema.memories.sourceType,
          confidence: schema.memories.confidence, updatedAt: schema.memories.updatedAt,
          metadata: schema.memories.metadata,
        })
        .from(schema.memories)
        .where(and(...condicoes))
        .orderBy(desc(schema.memories.updatedAt))
        .limit(args.limit ?? 10);

      return {
        results: linhas.map((m) => {
          const statusMcp = String((m.metadata as Record<string, unknown> | null)?.mcp_status ?? 'OBSERVED');
          const { citavel, ressalva } = ehCitavel({ status: (statusMcp as never) });
          return {
            memory_id: m.id,
            kind: m.kind,
            content: m.content.slice(0, 900),
            source: m.sourceType,
            confidence: m.confidence,
            status: statusMcp,
            citable: citavel,
            caveat: ressalva,
            updated_at: m.updatedAt,
          };
        }),
        count: linhas.length,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_recent_decisions',
    descricao:
      'As últimas decisões registradas, com data e autor. Responde "qual foi a última decisão tomada para essa campanha?".',
    entrada: {
      client_id: z.string().uuid().optional(),
      days: z.number().int().min(1).max(180).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    scope: 'memory.read',
    acesso: 'READ',
    recurso: 'decision',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const desde = new Date(Date.now() - (args.days ?? 30) * 86_400_000);
      const condicoes = [
        eq(schema.operationalEvents.organizationId, ctx.principal.organizationId),
        or(
          eq(schema.operationalEvents.type, 'CLIENT_DECISION'),
          eq(schema.operationalEvents.type, 'STRATEGY_CHANGED'),
          eq(schema.operationalEvents.type, 'CREATIVE_APPROVED'),
          eq(schema.operationalEvents.type, 'CREATIVE_REJECTED'),
        )!,
        sql`coalesce(${schema.operationalEvents.occurredAt}, ${schema.operationalEvents.createdAt}) >= ${desde.toISOString()}`,
      ];
      if (args.client_id) condicoes.push(eq(schema.operationalEvents.clientId, args.client_id));
      const linhas = await db
        .select({
          type: schema.operationalEvents.type, summary: schema.operationalEvents.summary,
          actor: schema.operationalEvents.actor, occurredAt: schema.operationalEvents.occurredAt,
          clientId: schema.operationalEvents.clientId, payload: schema.operationalEvents.payload,
        })
        .from(schema.operationalEvents)
        .where(and(...condicoes))
        .orderBy(desc(schema.operationalEvents.occurredAt))
        .limit(args.limit ?? 20);
      return {
        decisions: linhas.map((d) => ({ type: d.type, summary: d.summary, by: d.actor, at: d.occurredAt, client_id: d.clientId, detail: d.payload })),
        count: linhas.length,
      };
    },
  });

  registrarTool(deps, {
    nome: 'log_operational_event',
    descricao:
      'Registra na memória da agência algo que ACONTECEU e que outro funcionário vai precisar saber depois: ' +
      'decisão de cliente, feedback confirmado, criativo aprovado ou rejeitado, aprendizado de processo, erro encontrado. ' +
      'NÃO registre brainstorm, hipótese, conversa casual nem ideia que ainda não foi aprovada — isso é recusado e com razão.',
    entrada: {
      event_type: z.enum(MCP_EVENT_TYPES as unknown as [McpEventType, ...McpEventType[]]),
      summary: z.string().min(12).describe('Uma frase que faça sentido para um colega daqui a três meses.'),
      client_id: z.string().uuid().optional(),
      task_id: z.string().optional(),
      importance: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
      visibility: z.enum(['PRIVATE', 'TEAM', 'CLIENT_SCOPED']).optional(),
      detail: z.record(z.unknown()).optional().describe('Dados estruturados de apoio.'),
      idempotency_key: z.string().optional(),
    },
    scope: 'memory.write',
    acesso: 'WRITE',
    recurso: 'operational_event',
    executar: async (args, ctx) => {
      if (!isMcpEventType(args.event_type)) {
        return { error: 'UNKNOWN_EVENT_TYPE', message: `Tipo desconhecido: ${args.event_type}` };
      }
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);

      /**
       * O FILTRO DO §10, aplicado em código e não em instrução. Instrução de
       * organização é conselho; isto é regra, e vale igual para todo mundo.
       */
      const veredicto = deveRegistrar({ eventType: args.event_type, summary: args.summary });
      if (!veredicto.registrar) {
        return {
          status: 'NOT_RECORDED',
          reason: veredicto.motivo,
          message:
            'Não registrei: a memória da agência guarda o que foi decidido ou aprendido, não o que está sendo cogitado. ' +
            'Quando confirmar, registre de novo.',
        };
      }

      const chave = args.idempotency_key ?? `mcp:${args.event_type}:${ctx.principal.userId}:${Buffer.from(args.summary).toString('base64url').slice(0, 40)}`;
      const inseridas = await db
        .insert(schema.operationalEvents)
        .values({
          source: 'chat',
          type: args.event_type,
          externalId: chave,
          organizationId: ctx.principal.organizationId,
          userId: ctx.principal.userId,
          employeeId: ctx.principal.employeeId,
          clientId: args.client_id ?? null,
          taskId: args.task_id ?? null,
          entityType: args.task_id ? 'task' : 'note',
          entityId: args.task_id ?? null,
          actor: ctx.principal.name,
          summary: args.summary,
          importance: args.importance ?? importanciaPadrao(args.event_type),
          visibility: args.visibility ?? 'TEAM',
          payload: (args.detail ?? {}) as Record<string, unknown>,
          occurredAt: new Date(),
          /**
           * SEM processedAt aqui, de propósito (30/09/2026): marcado como já
           * processado, o evento nunca era reclamado por processPendingEvents
           * (apps/worker) e o vocabulário de negócio do MCP — CLIENT_DECISION,
           * STRATEGY_CHANGED... — nunca virava sinal proativo, mesmo depois de
           * event-intelligence.ts aprender a interpretá-lo. `processedAt` fica
           * null; o job de 5 em 5 min reclama, classifica e marca.
           */
        })
        // A tabela já é idempotente por (source, external_id) desde sempre —
        // aproveitamos a garantia que existe em vez de inventar outra.
        .onConflictDoNothing({ target: [schema.operationalEvents.source, schema.operationalEvents.externalId] })
        .returning({ id: schema.operationalEvents.id });

      if (inseridas.length === 0) {
        return { status: 'ALREADY_RECORDED', message: 'Esse acontecimento já estava registrado.' };
      }
      await registrarAuditoria(
        { principal: ctx.principal, tool: 'log_operational_event', resourceType: 'operational_event', resourceId: inseridas[0]!.id, clientId: args.client_id ?? null, newValue: { type: args.event_type, summary: args.summary }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      return { status: 'RECORDED', event_id: inseridas[0]!.id, type: args.event_type };
    },
  });

  registrarTool(deps, {
    nome: 'log_work',
    descricao:
      'Registra que um trabalho foi concluído, para que os colegas e o gestor vejam. ' +
      'Ex.: "Finalizei os três criativos de outubro da Envu". Atalho de log_operational_event para o caso mais comum.',
    entrada: {
      summary: z.string().min(12),
      client_id: z.string().uuid().optional(),
      task_id: z.string().optional(),
    },
    scope: 'memory.write',
    acesso: 'WRITE',
    recurso: 'operational_event',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const chave = `mcp:WORK_LOGGED:${ctx.principal.userId}:${Buffer.from(args.summary).toString('base64url').slice(0, 40)}`;
      const inseridas = await db
        .insert(schema.operationalEvents)
        .values({
          source: 'chat', type: 'WORK_LOGGED', externalId: chave,
          organizationId: ctx.principal.organizationId, userId: ctx.principal.userId,
          employeeId: ctx.principal.employeeId, clientId: args.client_id ?? null,
          taskId: args.task_id ?? null, entityType: 'work', entityId: args.task_id ?? null,
          actor: ctx.principal.name, summary: args.summary, importance: 'NORMAL', visibility: 'TEAM',
          // Sem processedAt — mesmo motivo do log_operational_event acima.
          occurredAt: new Date(),
        })
        .onConflictDoNothing({ target: [schema.operationalEvents.source, schema.operationalEvents.externalId] })
        .returning({ id: schema.operationalEvents.id });
      if (inseridas.length === 0) return { status: 'ALREADY_RECORDED' };
      await registrarAuditoria(
        { principal: ctx.principal, tool: 'log_work', resourceType: 'operational_event', resourceId: inseridas[0]!.id, clientId: args.client_id ?? null, newValue: { summary: args.summary }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      return { status: 'RECORDED', event_id: inseridas[0]!.id };
    },
  });

  registrarTool(deps, {
    nome: 'save_client_feedback',
    descricao:
      'Guarda um retorno que o CLIENTE deu, com as palavras dele. Ex.: "não querem mais comunicação promocional agressiva". ' +
      'Fica disponível para todo mundo da agência daqui em diante. Registre só o que o cliente realmente disse, não sua interpretação.',
    entrada: {
      client_id: z.string().uuid(),
      feedback: z.string().min(12),
      is_restriction: z.boolean().optional().describe('true quando é um veto ("nunca faça X").'),
    },
    scope: 'memory.write',
    acesso: 'WRITE',
    recurso: 'memory',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const [memoria] = await db
        .insert(schema.memories)
        .values({
          kind: args.is_restriction ? 'client.restriction' : 'client.feedback',
          content: args.feedback,
          organizationId: ctx.principal.organizationId,
          clientId: cliente.id,
          userId: ctx.principal.userId,
          sourceType: 'claude',
          /**
           * Vem do Claude relatando uma conversa: nasce OBSERVED, com a
           * confiança mais baixa da tabela. Virar política exige um humano com
           * papel de gestão aprovar (ver `podeAprovar`).
           */
          confidence: String(confiancaInicial('claude')),
          status: 'active',
          metadata: {
            mcp_status: statusInicial('claude'),
            recorded_by: ctx.principal.name,
            employee_id: ctx.principal.employeeId,
            session_id: ctx.principal.sessionId,
          },
        })
        .returning({ id: schema.memories.id });

      await db.insert(schema.operationalEvents).values({
        source: 'chat', type: 'CLIENT_FEEDBACK',
        externalId: `mcp:feedback:${memoria!.id}`,
        organizationId: ctx.principal.organizationId, userId: ctx.principal.userId,
        employeeId: ctx.principal.employeeId, clientId: cliente.id,
        entityType: 'memory', entityId: memoria!.id, actor: ctx.principal.name,
        summary: `Feedback de ${cliente.name}: ${args.feedback.slice(0, 200)}`,
        importance: args.is_restriction ? 'HIGH' : 'NORMAL', visibility: 'CLIENT_SCOPED',
        // Sem processedAt — mesmo motivo do log_operational_event acima.
        occurredAt: new Date(),
      }).onConflictDoNothing();

      await registrarAuditoria(
        { principal: ctx.principal, tool: 'save_client_feedback', resourceType: 'memory', resourceId: memoria!.id, clientId: cliente.id, newValue: { feedback: args.feedback.slice(0, 500) }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      return {
        status: 'SAVED',
        memory_id: memoria!.id,
        memory_status: 'OBSERVED',
        note: 'Registrado como relato não confirmado. Um gestor pode promovê-lo a política da agência.',
      };
    },
  });

  registrarTool(deps, {
    nome: 'save_learning',
    descricao:
      'Guarda um aprendizado de processo da agência: o que funcionou, o que não funcionou, o que evitar da próxima vez. ' +
      'Use quando algo foi CONCLUÍDO e gerou lição, não quando ainda é suposição.',
    entrada: {
      learning: z.string().min(12),
      client_id: z.string().uuid().optional(),
    },
    scope: 'memory.write',
    acesso: 'WRITE',
    recurso: 'memory',
    executar: async (args, ctx) => {
      const veredicto = deveRegistrar({ eventType: 'PROCESS_LEARNING', summary: args.learning });
      if (!veredicto.registrar) {
        return { status: 'NOT_RECORDED', reason: veredicto.motivo };
      }
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const [memoria] = await db
        .insert(schema.memories)
        .values({
          kind: 'process.learning', content: args.learning,
          organizationId: ctx.principal.organizationId,
          clientId: args.client_id ?? null, userId: ctx.principal.userId,
          sourceType: 'claude', confidence: String(confiancaInicial('claude')), status: 'active',
          metadata: { mcp_status: statusInicial('claude'), recorded_by: ctx.principal.name, session_id: ctx.principal.sessionId },
        })
        .returning({ id: schema.memories.id });
      await registrarAuditoria(
        { principal: ctx.principal, tool: 'save_learning', resourceType: 'memory', resourceId: memoria!.id, clientId: args.client_id ?? null, newValue: { learning: args.learning.slice(0, 500) }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      return { status: 'SAVED', memory_id: memoria!.id, memory_status: 'OBSERVED' };
    },
  });

  registrarTool(deps, {
    nome: 'get_recent_events',
    descricao:
      'O que mudou na agência recentemente, por todo mundo. Responde "o que aconteceu hoje?" e "o que mudou desde ontem?". ' +
      'É a visão que o Bento usa — e é a vantagem que uma IA externa não tem, porque ela vê o estado de agora, não a trajetória.',
    entrada: {
      days: z.number().int().min(1).max(90).optional().describe('Padrão 1 (hoje).'),
      client_id: z.string().uuid().optional(),
      min_importance: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'operational_event',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const desde = new Date(Date.now() - (args.days ?? 1) * 86_400_000);
      const ordem: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
      const condicoes = [
        sql`coalesce(${schema.operationalEvents.occurredAt}, ${schema.operationalEvents.createdAt}) >= ${desde.toISOString()}`,
        /**
         * A fronteira aqui é dupla, e a segunda metade é o que deixa o evento
         * do WEBHOOK aparecer: ele nasce sem `organization_id` (é anterior à
         * migração 0044) mas com `client_id`, e o cliente já pertence a uma
         * organização. Sem isso, "o que mudou hoje?" só mostraria o que foi
         * registrado pelo MCP e esconderia tudo que veio do ClickUp.
         */
        or(
          eq(schema.operationalEvents.organizationId, ctx.principal.organizationId),
          sql`${schema.operationalEvents.clientId} in (select id from clients where organization_id = ${ctx.principal.organizationId} and deleted_at is null)`,
        )!,
        or(
          sql`${schema.operationalEvents.visibility} <> 'PRIVATE'`,
          eq(schema.operationalEvents.userId, ctx.principal.userId),
        )!,
      ];
      if (args.client_id) condicoes.push(eq(schema.operationalEvents.clientId, args.client_id));

      const linhas = await db
        .select({
          type: schema.operationalEvents.type, summary: schema.operationalEvents.summary,
          actor: schema.operationalEvents.actor, occurredAt: schema.operationalEvents.occurredAt,
          clientId: schema.operationalEvents.clientId, importance: schema.operationalEvents.importance,
          source: schema.operationalEvents.source, taskId: schema.operationalEvents.taskId,
        })
        .from(schema.operationalEvents)
        .where(and(...condicoes))
        .orderBy(desc(schema.operationalEvents.occurredAt))
        .limit(args.limit ?? 40);

      const minimo = ordem[args.min_importance ?? 'LOW'] ?? 0;
      const filtradas = linhas.filter((e) => (ordem[e.importance ?? 'LOW'] ?? 0) >= minimo);
      return {
        window_days: args.days ?? 1,
        events: filtradas.map((e) => ({
          type: e.type, summary: e.summary, by: e.actor, at: e.occurredAt,
          client_id: e.clientId, task_id: e.taskId, importance: e.importance, source: e.source,
        })),
        count: filtradas.length,
        note: filtradas.some((e) => !e.summary)
          ? 'Eventos vindos do webhook do ClickUp não têm resumo nem autor: o payload do provedor não traz essa informação. Não invente quem mexeu.'
          : undefined,
      };
    },
  });
}
