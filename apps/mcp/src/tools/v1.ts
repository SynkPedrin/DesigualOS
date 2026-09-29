import { z } from 'zod';
import { and, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildChangeContext, escopoOperacional, naturezaDoCliente,
} from '@desigual-os/context-engine';
import {
  escopoPadrao, filtrarVisiveis, isMemoryScope, MEMORY_SCOPES, temScope,
  type MemoryScope,
} from '@desigual-os/mcp-domain';
import { registrarAuditoria } from '../audit.js';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao, resumoDeTask } from './identity-clients.js';

/**
 * v1.ts — as ferramentas do contrato V1 do control plane.
 *
 * O que separa estas das anteriores não é o assunto, é a POSTURA: aqui o
 * Desigual OS não tenta responder, ele entrega verdade operacional para o
 * Claude do funcionário raciocinar em cima. Nenhuma faz inferência de modelo —
 * se o Claude já está pensando, uma segunda inferência aqui é custo duplo.
 */

/** Clientes da organização que o principal pode ver, sem fixture de QA. */
async function carteiraVisivel(organizationId: string): Promise<Array<{ id: string; name: string; listId: string | null }>> {
  const linhas = await db
    .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)));
  return escopoOperacional(linhas);
}

export function registrarToolsV1(deps: RegistrarToolDeps): void {
  /* ─────────────────────────────────────────────────────────────────────
   * 1. PANORAMA DA OPERAÇÃO
   * ──────────────────────────────────────────────────────────────────── */
  registrarTool(deps, {
    nome: 'get_operation_overview',
    descricao:
      'O estado da agência inteira agora: carteira, trabalho interno separado, atrasos, tarefas sem responsável, ' +
      'concentração por pessoa e o que mudou nas últimas 24h. É a primeira chamada para "como está a operação?".',
    entrada: {
      include_internal: z.boolean().optional().describe('Somar as frentes internas da agência. Padrão: separadas, não somadas.'),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'operation',
    executar: async (args, ctx) => {
      const clientes = await carteiraVisivel(ctx.principal.organizationId);
      const pagina = await ctx.providers.tasks.searchTasks({ limit: 100 });
      const agora = Date.now();

      const internas = new Set(clientes.filter((c) => naturezaDoCliente(c.name) === 'INTERNO').map((c) => c.name));
      const daCarteira = pagina.tasks.filter((t) => !internas.has(t.clientName ?? ''));
      const daCasa = pagina.tasks.filter((t) => internas.has(t.clientName ?? ''));
      const alvo = args.include_internal ? pagina.tasks : daCarteira;

      const porPessoa = new Map<string, { abertas: number; atrasadas: number }>();
      for (const t of alvo) {
        for (const p of t.assignees) {
          const v = porPessoa.get(p) ?? { abertas: 0, atrasadas: 0 };
          v.abertas += 1;
          if (t.dueDate !== null && t.dueDate < agora) v.atrasadas += 1;
          porPessoa.set(p, v);
        }
      }
      const porCliente = new Map<string, number>();
      for (const t of alvo) porCliente.set(t.clientName ?? 'sem cliente', (porCliente.get(t.clientName ?? 'sem cliente') ?? 0) + 1);

      const desde = new Date(agora - 86_400_000);
      const eventos = await db
        .select({ tipo: schema.operationalEvents.type, quando: schema.operationalEvents.occurredAt })
        .from(schema.operationalEvents)
        .where(sql`coalesce(${schema.operationalEvents.occurredAt}, ${schema.operationalEvents.createdAt}) >= ${desde.toISOString()}`)
        .limit(500)
        .catch(() => []);

      const semLista = clientes.filter((c) => !c.listId);
      return {
        carteira: {
          clientes_ativos: clientes.filter((c) => naturezaDoCliente(c.name) === 'CLIENTE').length,
          tarefas_abertas: daCarteira.length,
          atrasadas: daCarteira.filter((t) => t.dueDate !== null && t.dueDate < agora).length,
          sem_responsavel: daCarteira.filter((t) => t.assignees.length === 0).length,
        },
        interno: {
          nota: 'Frentes da própria agência (site, processo, produto interno). NÃO são cliente e não entram na carteira.',
          tarefas_abertas: daCasa.length,
          atrasadas: daCasa.filter((t) => t.dueDate !== null && t.dueDate < agora).length,
        },
        concentracao: [...porPessoa.entries()]
          .map(([pessoa, v]) => ({ pessoa, abertas: v.abertas, atrasadas: v.atrasadas }))
          .sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas)
          .slice(0, 12),
        por_cliente: [...porCliente.entries()].map(([cliente, n]) => ({ cliente, abertas: n })).sort((a, b) => b.abertas - a.abertas).slice(0, 15),
        mudancas_24h: { total: eventos.length, criadas: eventos.filter((e) => e.tipo === 'task.created').length, alteradas: eventos.filter((e) => e.tipo === 'task.updated').length },
        truncated: pagina.truncated,
        /** O buraco declarado: sem isto, "não apareceu" é lido como "não há trabalho". */
        clientes_sem_rastreio: semLista.map((c) => c.name),
        caveat: semLista.length ? `${semLista.length} cliente(s) não têm lista do ClickUp e NÃO aparecem em nenhum número acima.` : null,
      };
    },
  });

  /* ─────────────────────────────────────────────────────────────────────
   * 2. OPERAÇÃO DE UM CLIENTE — nunca cai para global em silêncio
   * ──────────────────────────────────────────────────────────────────── */
  registrarTool(deps, {
    nome: 'get_client_operation',
    descricao:
      'O estado operacional de UM cliente: tarefas abertas, atrasadas, sem dono, aguardando aprovação, e quem sustenta. ' +
      'Se o cliente não for encontrado, devolve erro — NUNCA responde pela agência inteira no lugar.',
    entrada: {
      client_id: z.string().uuid().describe('Id do cliente. Use search_clients se só tiver o nome.'),
      include_closed: z.boolean().optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'client_operation',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      if (!cliente.clickupListId) {
        return {
          error: 'NO_TASK_TRACKING',
          client: cliente.name,
          message: `${cliente.name} não tem lista do ClickUp vinculada. Ausência de tarefa aqui NÃO significa ausência de trabalho.`,
        };
      }
      const pagina = await ctx.providers.tasks.searchTasks({
        clientIds: [cliente.id],
        ...(args.include_closed !== undefined ? { includeClosed: args.include_closed } : {}),
        limit: 100,
      });
      const agora = Date.now();
      const porPessoa = new Map<string, number>();
      for (const t of pagina.tasks) for (const p of t.assignees) porPessoa.set(p, (porPessoa.get(p) ?? 0) + 1);
      return {
        client: cliente.name,
        client_id: cliente.id,
        abertas: pagina.tasks.length,
        atrasadas: pagina.tasks.filter((t) => t.dueDate !== null && t.dueDate < agora).length,
        sem_responsavel: pagina.tasks.filter((t) => t.assignees.length === 0).length,
        quem_sustenta: [...porPessoa.entries()].map(([pessoa, n]) => ({ pessoa, tarefas: n })).sort((a, b) => b.tarefas - a.tarefas),
        tasks: pagina.tasks.map(resumoDeTask),
        truncated: pagina.truncated,
      };
    },
  });

  /* ─────────────────────────────────────────────────────────────────────
   * 3. O QUE MUDOU — do event store, sem inventar campo
   * ──────────────────────────────────────────────────────────────────── */
  registrarTool(deps, {
    nome: 'get_recent_changes',
    descricao:
      'O que MUDOU na operação num período — não o que está aberto. Vem do histórico próprio do Desigual OS. ' +
      'É a pergunta que uma IA sem este sistema não consegue responder: ela vê o estado de agora, não a trajetória.',
    entrada: {
      client_id: z.string().uuid().optional(),
      days: z.number().int().min(1).max(90).optional().describe('Janela em dias. Padrão 1.'),
    },
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'change',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const clientes = await carteiraVisivel(ctx.principal.organizationId);
      const desde = new Date(Date.now() - (args.days ?? 1) * 86_400_000);

      const condicoes = [sql`coalesce(${schema.operationalEvents.occurredAt}, ${schema.operationalEvents.createdAt}) >= ${desde.toISOString()}`];
      if (args.client_id) condicoes.push(eq(schema.operationalEvents.clientId, args.client_id));
      const eventos = await db
        .select({
          type: schema.operationalEvents.type, entityId: schema.operationalEvents.entityId,
          clientId: schema.operationalEvents.clientId, actor: schema.operationalEvents.actor,
          occurredAt: schema.operationalEvents.occurredAt, summary: schema.operationalEvents.summary,
        })
        .from(schema.operationalEvents)
        .where(and(...condicoes))
        .orderBy(desc(schema.operationalEvents.occurredAt))
        .limit(300);

      const pagina = await ctx.providers.tasks.searchTasks({
        ...(args.client_id ? { clientIds: [args.client_id] } : {}),
        limit: 100,
      });
      const mudanca = buildChangeContext({
        eventos: eventos.map((e) => ({ type: e.type, entityId: e.entityId, clientId: e.clientId, actor: e.actor, occurredAt: e.occurredAt })),
        tasks: pagina.tasks.map((t) => ({
          id: t.id, name: t.title, status: t.status, statusType: t.statusType, priority: t.priority,
          dueDate: t.dueDate, assignees: t.assignees, listId: null, listName: t.clientName, url: t.url,
        })),
        clientNameById: new Map(clientes.map((c) => [c.id, c.name])),
        janelaLabel: `últimos ${args.days ?? 1} dia(s)`,
      });
      return {
        window_days: args.days ?? 1,
        tarefas_que_mudaram: mudanca.criadas + mudanca.atualizadas,
        criadas: mudanca.criadas,
        alteradas: mudanca.atualizadas,
        nao_estao_mais_abertas: mudanca.naoResolvidas,
        detalhe: mudanca.block,
        /** Honestidade obrigatória: o webhook do ClickUp não traz isto. */
        limitacao: 'O evento não registra QUAL campo mudou nem QUEM mexeu. Não afirme autor nem motivo a partir daqui.',
      };
    },
  });

  /* ─────────────────────────────────────────────────────────────────────
   * 4/5. MEMÓRIA — registrar e recuperar, com escopo
   * ──────────────────────────────────────────────────────────────────── */
  registrarTool(deps, {
    nome: 'remember',
    descricao:
      'Registra conhecimento durável da agência: uma decisão, uma regra, uma preferência de cliente, um aprendizado. ' +
      'Ex.: "Na 3Net nunca usar promessa de estabilidade durante chuva." Fica disponível para os colegas conforme o escopo. ' +
      'NÃO registre hipótese, brainstorm nem coisa que ainda está sendo pensada.',
    entrada: {
      content: z.string().min(12).describe('A regra ou decisão, como ela deve ser lida daqui a seis meses.'),
      scope: z.enum(MEMORY_SCOPES as unknown as [MemoryScope, ...MemoryScope[]]).optional()
        .describe('AGENCY, CLIENT, EMPLOYEE, DELIVERY_TYPE, CAMPAIGN, PROCESS ou USER_PRIVATE. Deduzido se omitido.'),
      client_id: z.string().uuid().optional(),
      subject: z.string().optional().describe('Do que trata, em poucas palavras. Usado para superseder a regra anterior do mesmo assunto.'),
      supersedes: z.string().uuid().optional().describe('Id da memória que esta substitui.'),
    },
    scope: 'memory.write',
    acesso: 'WRITE',
    recurso: 'memory',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const escopo: MemoryScope = args.scope && isMemoryScope(args.scope)
        ? args.scope
        : escopoPadrao({ clientId: args.client_id ?? null });

      const [criada] = await db
        .insert(schema.memories)
        .values({
          kind: `mcp.${escopo.toLowerCase()}`,
          content: args.content,
          clientId: args.client_id ?? null,
          userId: ctx.principal.userId,
          sourceType: 'claude',
          confidence: '0.5',
          status: 'active',
          metadata: {
            mcp_scope: escopo,
            mcp_status: 'OBSERVED',
            subject: args.subject ?? null,
            recorded_by: ctx.principal.name,
            employee_id: ctx.principal.employeeId,
            organization_id: ctx.principal.organizationId,
            session_id: ctx.principal.sessionId,
          },
        })
        .returning({ id: schema.memories.id });

      /**
       * SUPERSEDER NÃO APAGA. A regra antiga vira `superseded` e continua no
       * banco com quem a ensinou e quando — aprendizado auditável é o requisito,
       * e histórico apagado não se audita.
       */
      let aposentadas = 0;
      if (args.supersedes) {
        const r = await db
          .update(schema.memories)
          .set({ status: 'superseded', supersededBy: criada!.id, supersededAt: new Date() })
          .where(eq(schema.memories.id, args.supersedes))
          .returning({ id: schema.memories.id });
        aposentadas = r.length;
      }

      await registrarAuditoria(
        { principal: ctx.principal, tool: 'remember', resourceType: 'memory', resourceId: criada!.id, clientId: args.client_id ?? null, newValue: { scope: escopo, content: args.content.slice(0, 400) }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      return {
        status: 'SAVED',
        memory_id: criada!.id,
        scope: escopo,
        memory_status: 'OBSERVED',
        superseded: aposentadas,
        note: escopo === 'USER_PRIVATE'
          ? 'Privada: nenhum colega verá isto, nem um administrador.'
          : 'Registrado como relato não confirmado. Um gestor pode promovê-lo a política da agência.',
      };
    },
  });

  registrarTool(deps, {
    nome: 'recall',
    descricao:
      'Busca a memória institucional da agência: decisões, regras, preferências de cliente, aprendizados. ' +
      'Respeite a ressalva de cada item — "não confirmado" significa relato, não regra. Consulte ANTES de criar peça para um cliente.',
    entrada: {
      query: z.string().min(2),
      client_id: z.string().uuid().optional(),
      scope: z.enum(MEMORY_SCOPES as unknown as [MemoryScope, ...MemoryScope[]]).optional(),
      include_superseded: z.boolean().optional().describe('Trazer as regras que já foram substituídas. Padrão: só as vigentes.'),
      limit: z.number().int().min(1).max(30).optional(),
    },
    scope: 'memory.read',
    acesso: 'READ',
    recurso: 'memory',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const clientes = await carteiraVisivel(ctx.principal.organizationId);
      const permitidos = new Set(clientes.map((c) => c.id));

      const condicoes = [ilike(schema.memories.content, `%${args.query}%`)];
      if (!args.include_superseded) condicoes.push(eq(schema.memories.status, 'active'));
      if (args.client_id) condicoes.push(eq(schema.memories.clientId, args.client_id));

      const linhas = await db
        .select({
          id: schema.memories.id, content: schema.memories.content, kind: schema.memories.kind,
          clientId: schema.memories.clientId, userId: schema.memories.userId,
          status: schema.memories.status, confidence: schema.memories.confidence,
          sourceType: schema.memories.sourceType, metadata: schema.memories.metadata,
          updatedAt: schema.memories.updatedAt, supersededBy: schema.memories.supersededBy,
        })
        .from(schema.memories)
        .where(and(...condicoes))
        .orderBy(desc(schema.memories.updatedAt))
        .limit((args.limit ?? 10) * 3);

      /**
       * O FILTRO DE VISIBILIDADE roda em código, sobre o resultado, e não como
       * `where` — é uma função pura testada por varredura (memory-scope.ts).
       * Espalhar a regra por cada query é como memória privada vaza.
       */
      const comEscopo = linhas.map((m) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        const bruto = String(meta.mcp_scope ?? '');
        return {
          ...m,
          scope: (isMemoryScope(bruto) ? bruto : (m.clientId ? 'CLIENT' : 'AGENCY')) as MemoryScope,
        };
      });
      const visiveis = filtrarVisiveis(comEscopo, {
        userId: ctx.principal.userId,
        clientesPermitidos: permitidos,
        podeLerMemoria: temScope(ctx.principal.scopes, 'memory.read'),
      }).filter((m) => !args.scope || m.scope === args.scope);

      return {
        results: visiveis.slice(0, args.limit ?? 10).map((m) => {
          const meta = (m.metadata ?? {}) as Record<string, unknown>;
          return {
            memory_id: m.id,
            scope: m.scope,
            subject: meta.subject ?? null,
            content: m.content.slice(0, 900),
            source: m.sourceType,
            recorded_by: meta.recorded_by ?? null,
            confidence: m.confidence,
            status: m.status === 'superseded' ? 'SUPERSEDED' : (meta.mcp_status ?? 'OBSERVED'),
            superseded_by: m.supersededBy,
            caveat: m.status === 'superseded'
              ? 'Esta regra FOI SUBSTITUÍDA. Só use para entender o histórico.'
              : 'Relato não confirmado — verifique antes de tratar como regra da agência.',
            updated_at: m.updatedAt,
          };
        }),
        count: Math.min(visiveis.length, args.limit ?? 10),
      };
    },
  });

  /* ─────────────────────────────────────────────────────────────────────
   * 6. CONTEXTO DE UMA PESSOA
   * ──────────────────────────────────────────────────────────────────── */
  registrarTool(deps, {
    nome: 'get_employee_context',
    descricao:
      'O que uma pessoa da equipe tem na mão: carga, clientes, tarefas atrasadas. Responde "quem está segurando isso?" ' +
      'e "o que a Tammy precisa ver hoje?". A carga é a VISÍVEL no ClickUp — trabalho que não virou tarefa não aparece.',
    entrada: {
      name: z.string().min(2).describe('Nome da pessoa como ela aparece no ClickUp.'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'employee',
    executar: async (args, ctx) => {
      const pagina = await ctx.providers.tasks.searchTasks({ limit: 100 });
      const alvo = args.name.toLowerCase();
      const dela = pagina.tasks.filter((t) => t.assignees.some((a) => a.toLowerCase().includes(alvo)));
      if (dela.length === 0) {
        const nomes = [...new Set(pagina.tasks.flatMap((t) => t.assignees))].sort();
        return {
          error: 'NOT_FOUND',
          message: `Ninguém chamado "${args.name}" aparece como responsável em tarefa aberta.`,
          quem_aparece: nomes.slice(0, 25),
        };
      }
      const agora = Date.now();
      const porCliente = new Map<string, number>();
      for (const t of dela) porCliente.set(t.clientName ?? 'sem cliente', (porCliente.get(t.clientName ?? 'sem cliente') ?? 0) + 1);
      return {
        pessoa: [...new Set(dela.flatMap((t) => t.assignees).filter((a) => a.toLowerCase().includes(alvo)))][0] ?? args.name,
        abertas: dela.length,
        atrasadas: dela.filter((t) => t.dueDate !== null && t.dueDate < agora).length,
        clientes: [...porCliente.entries()].map(([cliente, n]) => ({ cliente, tarefas: n })).sort((a, b) => b.tarefas - a.tarefas),
        tasks: dela.sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)).slice(0, args.limit ?? 20).map(resumoDeTask),
        caveat: 'Carga VISÍVEL no ClickUp. Trabalho que não virou tarefa não aparece aqui.',
      };
    },
  });

  /* ─────────────────────────────────────────────────────────────────────
   * 7. SAÚDE DO PRÓPRIO CONTROL PLANE
   * ──────────────────────────────────────────────────────────────────── */
  registrarTool(deps, {
    nome: 'get_health',
    descricao:
      'Saúde do Desigual OS: banco, ClickUp, memória, event store, e as chamadas MCP das últimas 24h. ' +
      'Separa FALHA do sistema de RECUSA legítima — as duas exigem reações opostas e misturá-las esconde as duas.',
    entrada: {},
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'health',
    executar: async (_args, ctx) => {
      const desde = new Date(Date.now() - 86_400_000);
      const inicio = Date.now();

      const [bancoOk, clientes] = await Promise.all([
        db.execute(sql`select 1 as ok`).then(() => true).catch(() => false),
        carteiraVisivel(ctx.principal.organizationId).catch(() => []),
      ]);
      const latenciaBanco = Date.now() - inicio;

      const inicioClickUp = Date.now();
      const clickup = await ctx.providers.tasks
        .searchTasks({ limit: 1 })
        .then(() => ({ ok: true, ms: Date.now() - inicioClickUp }))
        .catch((e: Error) => ({ ok: false, ms: Date.now() - inicioClickUp, erro: e.message }));

      const chamadas = await db
        .select({ result: schema.auditLogs.result, tool: schema.auditLogs.tool })
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.source, 'mcp'), gte(schema.auditLogs.timestamp, desde)))
        .catch(() => []);

      const eventos = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.operationalEvents)
        .where(gte(schema.operationalEvents.createdAt, desde))
        .catch(() => [{ n: 0 }]);

      const memorias = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.memories)
        .where(eq(schema.memories.status, 'active'))
        .catch(() => [{ n: 0 }]);

      /**
       * A SEPARAÇÃO QUE NÃO PODE SER PERDIDA: "bloqueou uma duplicata" e
       * "negou por permissão" são o sistema FUNCIONANDO. Somá-las às falhas
       * já acusou 23% de erro num dia em que quase tudo estava certo.
       */
      const falhas = chamadas.filter((c) => c.result === 'error').length;
      const recusas = chamadas.filter((c) => c.result === 'denied' || c.result === 'blocked_duplicate').length;
      const sucessos = chamadas.filter((c) => c.result === 'success').length;

      return {
        mcp: { ok: true, escritas_24h: chamadas.length },
        banco: { ok: bancoOk, latencia_ms: latenciaBanco },
        clickup: clickup,
        memoria: { registros_ativos: memorias[0]?.n ?? 0 },
        event_store: { eventos_24h: eventos[0]?.n ?? 0 },
        carteira: { clientes: clientes.length, sem_rastreio: clientes.filter((c) => !c.listId).length },
        escritas_24h: {
          sucesso: sucessos,
          falha_do_sistema: falhas,
          recusa_legitima: recusas,
          nota: 'Recusa legítima (duplicata bloqueada, permissão negada) é o sistema funcionando, não erro.',
        },
      };
    },
  });
}
