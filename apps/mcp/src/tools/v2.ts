import { z } from 'zod';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { classificarStatusFuncional } from '@desigual-os/context-engine';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao, resumoDeTask } from './identity-clients.js';

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
}
