import { z } from 'zod';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao, resumoDeTask } from './identity-clients.js';
import { clientesDaOrganizacao } from '../providers/clickup-task-provider.js';

/**
 * operation.ts — as perguntas que o §7 lista, respondidas por ESTADO estruturado
 * e não por releitura de conversa.
 *
 * É a diferença entre o Bento e um chatbot com histórico: ele não precisa
 * lembrar do que foi dito, porque o estado da operação está consultável. Todas
 * as tools aqui são agregações determinísticas — nenhuma chama LLM (§18).
 */

export function registrarToolsDeOperacao(deps: RegistrarToolDeps): void {
  registrarTool(deps, {
    nome: 'get_operation_summary',
    descricao:
      'O panorama da operação inteira: quantas tarefas abertas, quantas atrasadas, quantas sem dono, e a distribuição por cliente. ' +
      'Responde "como está a operação hoje?". Os números são do ClickUp ao vivo, e tarefa concluída NÃO entra na contagem de aberta.',
    entrada: {
      top_clients: z.number().int().min(1).max(30).optional().describe('Quantos clientes listar. Padrão 10.'),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'operation',
    executar: async (args, ctx) => {
      const pagina = await ctx.providers.tasks.searchTasks({ limit: 100 });
      const agora = Date.now();
      const porCliente = new Map<string, number>();
      for (const t of pagina.tasks) {
        const nome = t.clientName ?? 'sem cliente vinculado';
        porCliente.set(nome, (porCliente.get(nome) ?? 0) + 1);
      }
      const clientes = await clientesDaOrganizacao(ctx.principal.organizationId);
      const semLista = clientes.filter((c) => !c.listId);
      return {
        open_tasks: pagina.tasks.length,
        overdue: pagina.tasks.filter((t) => t.dueDate !== null && t.dueDate < agora).length,
        unassigned: pagina.tasks.filter((t) => t.assignees.length === 0).length,
        by_client: [...porCliente.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, args.top_clients ?? 10)
          .map(([client, count]) => ({ client, count })),
        truncated: pagina.truncated,
        /**
         * O BURACO DECLARADO. Seis clientes da carteira não têm lista do
         * ClickUp (29/09/2026, John Deere entre eles). Sem esta linha, o
         * panorama parece completo e não é — e "não apareceu" seria lido como
         * "não há trabalho".
         */
        clients_without_task_tracking: semLista.map((c) => c.name),
        caveat: semLista.length
          ? `${semLista.length} cliente(s) não têm lista do ClickUp vinculada e NÃO aparecem em nenhum número acima.`
          : null,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_overdue_tasks',
    descricao: 'As tarefas que passaram do prazo e continuam abertas, da mais atrasada para a menos.',
    entrada: {
      client_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'task',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const pagina = await ctx.providers.tasks.searchTasks({
        ...(args.client_id ? { clientIds: [args.client_id] } : {}),
        limit: 100,
      });
      const agora = Date.now();
      const atrasadas = pagina.tasks
        .filter((t) => t.dueDate !== null && t.dueDate < agora)
        .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0))
        .slice(0, args.limit ?? 25);
      return {
        tasks: atrasadas.map((t) => ({
          ...resumoDeTask(t),
          days_overdue: t.dueDate ? Math.floor((agora - t.dueDate) / 86_400_000) : null,
        })),
        count: atrasadas.length,
        truncated: pagina.truncated,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_blockers',
    descricao:
      'O que está travando a operação: tarefas atrasadas sem responsável, e tarefas antigas sem prazo definido. ' +
      'São os dois padrões que fazem trabalho parar sem ninguém perceber.',
    entrada: { limit: z.number().int().min(1).max(50).optional() },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'operation',
    executar: async (args, ctx) => {
      const pagina = await ctx.providers.tasks.searchTasks({ limit: 100 });
      const agora = Date.now();
      const limite = args.limit ?? 15;
      const orfasAtrasadas = pagina.tasks.filter((t) => t.assignees.length === 0 && t.dueDate !== null && t.dueDate < agora);
      const semPrazo = pagina.tasks.filter((t) => t.dueDate === null);
      return {
        overdue_without_owner: {
          count: orfasAtrasadas.length,
          // O motivo vai junto: "está aqui porque venceu e não tem dono" é
          // acionável; uma lista sem motivo vira mais uma lista.
          reason: 'venceu e não tem responsável — ninguém foi avisado de que parou',
          tasks: orfasAtrasadas.slice(0, limite).map(resumoDeTask),
        },
        no_due_date: {
          count: semPrazo.length,
          reason: 'sem prazo: não aparece em nenhum alerta de atraso, então pode ficar parada para sempre',
          tasks: semPrazo.slice(0, limite).map(resumoDeTask),
        },
        truncated: pagina.truncated,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_employee_workload',
    descricao:
      'Quanta coisa cada pessoa da equipe tem em aberto, e quanto disso está atrasado. Responde "quem está sobrecarregado?". ' +
      'A contagem sai dos responsáveis das tarefas — quem não aparece como responsável em nada não aparece aqui.',
    entrada: { limit: z.number().int().min(1).max(50).optional() },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'workload',
    executar: async (args, ctx) => {
      const pagina = await ctx.providers.tasks.searchTasks({ limit: 100 });
      const agora = Date.now();
      const porPessoa = new Map<string, { abertas: number; atrasadas: number; clientes: Set<string> }>();
      for (const t of pagina.tasks) {
        for (const pessoa of t.assignees) {
          const atual = porPessoa.get(pessoa) ?? { abertas: 0, atrasadas: 0, clientes: new Set<string>() };
          atual.abertas += 1;
          if (t.dueDate !== null && t.dueDate < agora) atual.atrasadas += 1;
          if (t.clientName) atual.clientes.add(t.clientName);
          porPessoa.set(pessoa, atual);
        }
      }
      const semDono = pagina.tasks.filter((t) => t.assignees.length === 0).length;
      return {
        workload: [...porPessoa.entries()]
          .map(([person, v]) => ({ person, open: v.abertas, overdue: v.atrasadas, clients: v.clientes.size }))
          .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
          .slice(0, args.limit ?? 20),
        unassigned_tasks: semDono,
        truncated: pagina.truncated,
        caveat: 'Esta é a carga VISÍVEL no ClickUp. Trabalho que não virou tarefa não aparece.',
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_campaign_performance',
    descricao:
      'Desempenho de mídia de um cliente: investimento, impressões, cliques, CTR, CPC, leads, CPL e conversões, quando existirem. ' +
      'Quando o dado não estiver disponível, devolve DATA_NOT_AVAILABLE — nunca estima nem preenche buraco.',
    entrada: {
      client_id: z.string().uuid(),
      from: z.string().optional().describe('AAAA-MM-DD.'),
      to: z.string().optional().describe('AAAA-MM-DD.'),
    },
    scope: 'traffic.read',
    acesso: 'READ',
    recurso: 'campaign',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const r = await ctx.providers.traffic.getCampaignPerformance(cliente.id, {
        ...(args.from ? { from: args.from } : {}),
        ...(args.to ? { to: args.to } : {}),
      });
      if (r.status === 'DATA_NOT_AVAILABLE') {
        return {
          status: 'DATA_NOT_AVAILABLE',
          client: cliente.name,
          reason: r.reason,
          /**
           * A instrução explícita existe porque número inventado sobre verba de
           * cliente é o pior tipo de alucinação que este sistema pode produzir.
           */
          instruction: 'Diga que não conseguiu consultar. NÃO estime, NÃO use número de memória, NÃO compare períodos.',
        };
      }
      return { status: 'OK', client: cliente.name, campaigns: r.data };
    },
  });
}
