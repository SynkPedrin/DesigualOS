import { z } from 'zod';
import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { classificarStatusFuncional, escopoOperacional } from '@desigual-os/context-engine';
import { McpAuthorizationError } from '@desigual-os/mcp-domain';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao, resumoDeTask } from './identity-clients.js';
import { somenteMemoriaVisivelNoMcp } from './visibilidade-de-memoria.js';
import { fronteiraDeOrganizacao } from './fronteira-de-organizacao.js';

/**
 * v2.ts — a segunda leva do contrato original: aprovação e atividade dos
 * agentes.
 *
 * `get_workload` e `get_risks` do escopo original JÁ EXISTEM sob outro nome —
 * `get_employee_workload` (tools/operation.ts) e `get_blockers`
 * (tools/operation.ts, que cobre exatamente "atrasada sem dono" + "sem
 * prazo", os dois padrões de risco silencioso). Renomear ou duplicar
 * quebraria o contrato que 33 tools e a bateria de aceite já testam contra
 * produção — a missão pede não duplicar o que existe, e isso vale pro nome
 * também, não só pro código por trás dele.
 *
 * O que é GENUINAMENTE novo: aprovação (ninguém media isso ainda) e atividade
 * dos agentes (não é dado operacional, é dado de AUDITORIA — outra tabela,
 * outra pergunta).
 */

export function registrarToolsV2(deps: RegistrarToolDeps): void {
  registrarTool(deps, {
    nome: 'get_approvals',
    descricao:
      'Tarefas paradas esperando aprovação — do cliente ou de revisão interna. É o gargalo que não aparece em ' +
      '"atrasada": a tarefa pode estar no prazo e mesmo assim travada porque ninguém deu retorno. Cobrar essas ' +
      'destrava a fila sem precisar de mais gente.',
    entrada: {
      client_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'approval',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const pagina = await ctx.providers.tasks.searchTasks({
        ...(args.client_id ? { clientIds: [args.client_id] } : {}),
        limit: 100,
      });
      const emAprovacao = pagina.tasks.filter((t) => classificarStatusFuncional(t.status) === 'approval');
      const agora = Date.now();
      return {
        count: emAprovacao.length,
        overdue_while_waiting: emAprovacao.filter((t) => t.dueDate !== null && t.dueDate < agora).length,
        tasks: emAprovacao.slice(0, args.limit ?? 25).map(resumoDeTask),
        truncated: pagina.truncated,
        nota: 'Classificado pelo TEXTO do status ("aprovação", "revisão", "aguardando cliente"), não por uma coluna fixa — cada lista do ClickUp nomeia o status do jeito dela.',
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_agent_activity',
    descricao:
      'O que os agentes (Claude de cada funcionário, via este MCP) ESCREVERAM recentemente na operação — quem, ' +
      'qual ferramenta, sobre qual cliente, e se deu certo. É auditoria, não estado operacional: mostra AÇÃO, não ' +
      'tarefa. Só cobre escrita — leitura (buscar cliente, ver tarefa) não gera linha de auditoria, por desenho: ' +
      'auditar toda leitura de todo funcionário seria vigilância, não governança. ' +
      'Papel de governança — só quem administra a organização enxerga o que os outros fizeram.',
    entrada: {
      hours: z.number().int().min(1).max(168).optional().describe('Janela em horas. Padrão 24.'),
      user_id: z.string().uuid().optional().describe('Filtra por um funcionário específico.'),
      limit: z.number().int().min(1).max(100).optional(),
    },
    scope: 'admin.read',
    acesso: 'READ',
    recurso: 'audit_log',
    executar: async (args, ctx) => {
      const desde = new Date(Date.now() - (args.hours ?? 24) * 3_600_000);
      const condicoes = [
        eq(schema.auditLogs.source, 'mcp'),
        eq(schema.auditLogs.organizationId, ctx.principal.organizationId),
        gte(schema.auditLogs.timestamp, desde),
      ];
      if (args.user_id) condicoes.push(eq(schema.auditLogs.userId, args.user_id));

      const linhas = await db
        .select({
          timestamp: schema.auditLogs.timestamp, userId: schema.auditLogs.userId,
          tool: schema.auditLogs.tool, resourceType: schema.auditLogs.resourceType,
          resourceId: schema.auditLogs.resourceId, clientId: schema.auditLogs.clientId,
          result: schema.auditLogs.result, requestId: schema.auditLogs.requestId,
        })
        .from(schema.auditLogs)
        .where(and(...condicoes))
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(args.limit ?? 40);

      // Nome por id, resolvido uma vez por usuário distinto no lote — não por
      // linha, que repetiria a mesma consulta dezenas de vezes num turno
      // movimentado.
      const nomePorId = new Map<string, string>();
      for (const uid of new Set(linhas.map((l) => l.userId).filter((x): x is string => Boolean(x)))) {
        const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, uid)).catch(() => []);
        if (u) nomePorId.set(uid, u.name);
      }

      return {
        window_hours: args.hours ?? 24,
        count: linhas.length,
        activity: linhas.map((l) => ({
          at: l.timestamp,
          user: nomePorId.get(l.userId ?? '') ?? l.userId ?? 'desconhecido',
          tool: l.tool,
          resource: l.resourceType ? `${l.resourceType}${l.resourceId ? `:${l.resourceId}` : ''}` : null,
          client_id: l.clientId,
          result: l.result,
          request_id: l.requestId,
        })),
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_signals',
    descricao:
      'Alertas proativos pendentes: o que o Bento já decidiu que merece atenção humana AGORA, com uma próxima ' +
      'ação — decisão de cliente registrada, estratégia mudada, criativo rejeitado, erro relatado, QA reprovado, ' +
      'tarefa atrasada. Nem todo evento vira alerta aqui: silêncio não significa "nada aconteceu", significa "nada ' +
      'que precisasse da sua atenção agora". Consulte antes de perguntar "tem alguma pendência?" pro time.',
    entrada: {
      client_id: z.string().uuid().optional(),
      min_severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Padrão: medium.'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'signal',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);

      const ordem: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
      const piso = ordem[args.min_severity ?? 'medium'] ?? 1;

      /**
       * proactive_signals GANHOU organization_id na migração 0045
       * (30/09/2026) — antes desta tool depender de um subquery via
       * clientId (e sinal sem cliente ficar visível pra qualquer um, sem
       * fronteira nenhuma). fronteiraDeOrganizacao substitui os dois casos
       * de uma vez, e cobre o que o subquery antigo não cobria: sinal com
       * organizationId preenchido mas de OUTRA organização agora é excluído
       * de verdade, não só "sem cliente = visível pra todo mundo".
       */
      const condicoes = [
        eq(schema.proactiveSignals.status, 'pending'),
        fronteiraDeOrganizacao(schema.proactiveSignals.organizationId, ctx.principal.organizationId),
      ];
      if (args.client_id) condicoes.push(eq(schema.proactiveSignals.clientId, args.client_id));

      const linhas = await db
        .select({
          id: schema.proactiveSignals.id, rule: schema.proactiveSignals.rule, agent: schema.proactiveSignals.agent,
          clientId: schema.proactiveSignals.clientId, severity: schema.proactiveSignals.severity,
          title: schema.proactiveSignals.title, body: schema.proactiveSignals.body,
          recommendedAction: schema.proactiveSignals.recommendedAction, entityType: schema.proactiveSignals.entityType,
          entityId: schema.proactiveSignals.entityId, createdAt: schema.proactiveSignals.createdAt,
        })
        .from(schema.proactiveSignals)
        .where(and(...condicoes))
        .orderBy(desc(schema.proactiveSignals.createdAt))
        .limit((args.limit ?? 20) * 2);

      const filtrados = linhas.filter((s) => (ordem[s.severity] ?? 0) >= piso).slice(0, args.limit ?? 20);
      return {
        count: filtrados.length,
        signals: filtrados.map((s) => ({
          signal_id: s.id, rule: s.rule, agent: s.agent, severity: s.severity, title: s.title, body: s.body,
          recommended_action: s.recommendedAction, client_id: s.clientId,
          entity: s.entityType ? `${s.entityType}${s.entityId ? `:${s.entityId}` : ''}` : null,
          created_at: s.createdAt,
        })),
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_brain_overview',
    descricao:
      'O retrato de quanto a memória institucional já sabe: quantos clientes na carteira, quanta memória ativa ' +
      '(decisão, preferência, aprendizado) e quantas decisões recentes. É a resposta pronta pra "o que o Bento já ' +
      'aprendeu?" — use ao conectar um Claude novo ou quando alguém perguntar o tamanho do que já foi registrado. ' +
      'Cada número é contado agora, direto do banco — nunca estimado.',
    entrada: {
      client_id: z.string().uuid().optional().describe('Restringe o retrato a um cliente específico.'),
      decisions_days: z.number().int().min(1).max(180).optional().describe('Janela para "decisões recentes". Padrão 30.'),
    },
    scope: 'desigual.read',
    acesso: 'READ',
    recurso: 'brain_overview',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const janelaDias = args.decisions_days ?? 30;
      const desde = new Date(Date.now() - janelaDias * 86_400_000);

      /**
       * Carteira: mesma exclusão de fixture/interno que o resto do produto usa
       * (escopoOperacional) — sem isso, conta de QA e linha interna inflariam
       * "clientes na carteira" pra quem só quer saber o tamanho real.
       */
      const clientesBrutos = args.client_id
        ? [{ id: args.client_id, name: '' }]
        : await db
            .select({ id: schema.clients.id, name: schema.clients.name })
            .from(schema.clients)
            .where(and(eq(schema.clients.organizationId, ctx.principal.organizationId), sql`deleted_at is null`));
      const carteira = args.client_id ? clientesBrutos : escopoOperacional(clientesBrutos);
      const idsDaCarteira = carteira.map((c) => c.id);

      const condicoesMemoria = [
        eq(schema.memories.status, 'active'),
        somenteMemoriaVisivelNoMcp(ctx.principal.userId),
        // Fronteira de tenant (migração 0045) — ver ./fronteira-de-organizacao.ts.
        fronteiraDeOrganizacao(schema.memories.organizationId, ctx.principal.organizationId),
      ];
      if (args.client_id) condicoesMemoria.push(eq(schema.memories.clientId, args.client_id));
      const [memorias] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.memories)
        .where(and(...condicoesMemoria));

      const condicoesDecisao = [
        eq(schema.operationalEvents.organizationId, ctx.principal.organizationId),
        or(
          eq(schema.operationalEvents.type, 'CLIENT_DECISION'),
          eq(schema.operationalEvents.type, 'STRATEGY_CHANGED'),
          eq(schema.operationalEvents.type, 'CREATIVE_APPROVED'),
          eq(schema.operationalEvents.type, 'CREATIVE_REJECTED'),
        )!,
        sql`coalesce(${schema.operationalEvents.occurredAt}, ${schema.operationalEvents.createdAt}) >= ${desde.toISOString()}`,
      ];
      if (args.client_id) condicoesDecisao.push(eq(schema.operationalEvents.clientId, args.client_id));
      const [decisoes] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.operationalEvents)
        .where(and(...condicoesDecisao));

      const [ultimaMemoria] = await db
        .select({ at: schema.memories.updatedAt })
        .from(schema.memories)
        .where(and(...condicoesMemoria))
        .orderBy(desc(schema.memories.updatedAt))
        .limit(1);

      return {
        clients_in_portfolio: args.client_id ? null : idsDaCarteira.length,
        memories_count: memorias?.n ?? 0,
        decisions_count: decisoes?.n ?? 0,
        decisions_window_days: janelaDias,
        last_memory_update: ultimaMemoria?.at ?? null,
        nota: idsDaCarteira.length === 0 && !args.client_id
          ? 'Carteira vazia ou sem rastreio — não é ausência de dado, é o estado real agora.'
          : undefined,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_organizations',
    descricao:
      'As empresas que o Desigual OS atende: gente, carteira de clientes, conhecimento acumulado e última ' +
      'atividade de cada uma. É a visão do PROVEDOR — só quem opera no nível da plataforma enxerga isto. ' +
      'Não mostra "saudável" em selo verde: saúde por empresa exige medição que ainda não existe, e selo ' +
      'inventado é pior que selo nenhum.',
    entrada: {},
    scope: 'admin.read',
    acesso: 'READ',
    recurso: 'organization',
    executar: async (_args, ctx) => {
      /**
       * A MESMA consulta que apps/api/src/organizations/routes.ts usa — não
       * uma segunda versão da mesma pergunta. `ehProvider` já veio calculado
       * no principal (packages/mcp-domain, decidirEscopo), mas o gate aqui é
       * redundante de propósito: um principal cuja sessão foi montada antes
       * de PROVIDER_ORGANIZATION_ID existir não deveria, por estar "velho",
       * herdar acesso — a checagem explícita é o que torna isso impossível.
       */
      if (!ctx.principal.ehProvider) {
        throw new McpAuthorizationError(
          'PERMISSION_DENIED',
          'Só quem opera no nível da plataforma enxerga a lista de empresas.',
          { eh_provider: false },
        );
      }

      const provedora = ctx.principal.organizationIds.find((id) => id === process.env.PROVIDER_ORGANIZATION_ID);
      const bruto = await db.execute(sql`
        select
          o.id,
          o.name,
          (select count(*)::int from organization_members om where om.organization_id = o.id) as pessoas,
          (select count(*)::int from clients c
            where c.organization_id = o.id and c.deleted_at is null) as clientes,
          (select max(m.created_at) from messages m where m.organization_id = o.id) as ultima_atividade,
          (select count(*)::int from memories mem
            where mem.organization_id = o.id and mem.status = 'active') as memorias,
          (o.id = ${provedora ?? null}::uuid) as eh_provedora
        from organizations o
        order by (o.id = ${provedora ?? null}::uuid) desc, o.name
      `);
      const linhas = ((bruto as { rows?: unknown[] }).rows ?? (bruto as unknown[])) as Array<{
        id: string; name: string; pessoas: number; clientes: number;
        ultima_atividade: string | null; memorias: number; eh_provedora: boolean;
      }>;

      return {
        organizations: linhas.map((o) => ({
          id: o.id,
          name: o.name,
          eh_provedora: o.eh_provedora,
          pessoas: o.pessoas,
          clientes: o.clientes,
          memorias: o.memorias,
          // null = nenhuma mensagem registrada. Nunca "agora" nem data inventada.
          ultima_atividade: o.ultima_atividade ? new Date(o.ultima_atividade).toISOString() : null,
        })),
        gerado_em: new Date().toISOString(),
      };
    },
  });
}
