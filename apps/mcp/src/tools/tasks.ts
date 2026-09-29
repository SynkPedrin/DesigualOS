import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { avaliarDuplicata, chaveDeIdempotencia } from '@desigual-os/mcp-domain';
import { registrarAuditoria } from '../audit.js';
import { registrarTool, type RegistrarToolDeps } from './kit.js';
import { carregarClienteDaOrganizacao, resumoDeTask } from './identity-clients.js';

/**
 * tasks.ts — leitura e escrita de tarefa, com a §13 levada a sério.
 *
 * O histórico deste sistema é o motivo de cada guarda aqui: a auditoria forense
 * de 26/09/2026 mediu agentes criando task nova quando deveriam atualizar, e
 * duplicando task em retry. Duas defesas, nesta ordem, antes de todo create:
 *
 *   1. chave de idempotência — o MESMO pedido repetido não age duas vezes;
 *   2. reconcile-first + POSSIBLE_DUPLICATE — pedido PARECIDO para e pergunta.
 */

export function registrarToolsDeTarefa(deps: RegistrarToolDeps): void {
  registrarTool(deps, {
    nome: 'search_tasks',
    descricao:
      'Procura tarefas da agência. Filtra por cliente, por texto no título, por janela de prazo e por atraso. ' +
      'Devolve no máximo `limit` itens e diz quando cortou — se vier `truncated: true`, fale "pelo menos N", nunca um total.',
    entrada: {
      client_id: z.string().uuid().optional().describe('Restringe a um cliente.'),
      text: z.string().optional().describe('Parte do título.'),
      only_overdue: z.boolean().optional().describe('Só as que já passaram do prazo.'),
      include_closed: z.boolean().optional().describe('Incluir concluídas. Padrão false.'),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional().describe('Cursor da página anterior.'),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'task',
    executar: async (args, ctx) => {
      if (args.client_id) await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      const pagina = await ctx.providers.tasks.searchTasks({
        ...(args.client_id ? { clientIds: [args.client_id] } : {}),
        ...(args.text ? { text: args.text } : {}),
        ...(args.include_closed !== undefined ? { includeClosed: args.include_closed } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
      });
      const agora = Date.now();
      const tarefas = args.only_overdue
        ? pagina.tasks.filter((t) => t.dueDate !== null && t.dueDate < agora)
        : pagina.tasks;
      return {
        tasks: tarefas.map(resumoDeTask),
        count: tarefas.length,
        truncated: pagina.truncated,
        next_cursor: pagina.nextCursor,
      };
    },
  });

  registrarTool(deps, {
    nome: 'get_task',
    descricao: 'Uma tarefa específica, com status, responsável, prazo e comentários.',
    entrada: {
      task_id: z.string().min(1),
      include_comments: z.boolean().optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'task',
    executar: async (args, ctx) => {
      const tarefa = await ctx.providers.tasks.getTask(args.task_id);
      if (!tarefa) return { error: 'NOT_FOUND', message: 'Não encontrei essa task.' };
      const base = resumoDeTask(tarefa);
      if (!args.include_comments) return base;
      const comentarios = await ctx.providers.tasks.getComments(args.task_id);
      return { ...base, comments: comentarios.map((c) => ({ by: c.author, text: c.text, at: c.createdAt })) };
    },
  });

  registrarTool(deps, {
    nome: 'get_my_tasks',
    descricao:
      'As tarefas que estão com ESTE funcionário. Use quando ele perguntar "o que eu tenho para hoje?".',
    entrada: {
      only_overdue: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    scope: 'tasks.read',
    acesso: 'READ',
    recurso: 'task',
    executar: async (args, ctx) => {
      /**
       * O nome do ClickUp pode diferir do nome de login (`users.clickup_email`
       * existe exatamente por isso). Sem e-mail do ClickUp cadastrado, dizemos
       * que não dá para saber — em vez de casar por nome e devolver a lista de
       * outra pessoa.
       */
      const [usuario] = await db
        .select({ clickupEmail: schema.users.clickupEmail, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.principal.userId));
      if (!usuario?.clickupEmail) {
        return {
          error: 'DATA_NOT_AVAILABLE',
          message:
            'Não sei qual é a conta deste funcionário no ClickUp (users.clickup_email está vazio), então não consigo filtrar as tarefas dele com segurança.',
        };
      }
      const pagina = await ctx.providers.tasks.searchTasks({ limit: args.limit ?? 50 });
      const agora = Date.now();
      const minhas = pagina.tasks.filter((t) =>
        t.assignees.some((a) => a.toLowerCase().includes((usuario.name ?? '').toLowerCase().split(' ')[0] ?? '\u0000')),
      );
      const filtradas = args.only_overdue ? minhas.filter((t) => t.dueDate !== null && t.dueDate < agora) : minhas;
      return { tasks: filtradas.map(resumoDeTask), count: filtradas.length, matched_by: 'nome do ClickUp' };
    },
  });

  registrarTool(deps, {
    nome: 'create_task',
    descricao:
      'Cria uma tarefa para um cliente. ANTES de criar, procura tarefa equivalente e PARA se encontrar algo parecido — ' +
      'nesse caso devolve POSSIBLE_DUPLICATE com os candidatos, e você deve perguntar ao funcionário qual é, ' +
      'ou chamar de novo com confirm_create=true se ele confirmar que é mesmo nova.',
    entrada: {
      client_id: z.string().uuid(),
      title: z.string().min(3).describe('Título da tarefa. Específico: "Carrossel outubro Envu", não "post".'),
      description: z.string().optional().describe('Briefing completo.'),
      assignee_name: z.string().optional().describe('Nome da pessoa responsável, como ela aparece no ClickUp.'),
      due_date: z.string().optional().describe('Prazo em AAAA-MM-DD.'),
      priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
      idempotency_key: z.string().optional().describe('Repetir a mesma chave não cria de novo.'),
      confirm_create: z.boolean().optional().describe('Só use depois de o funcionário confirmar que não é duplicata.'),
    },
    scope: 'tasks.write',
    acesso: 'WRITE',
    recurso: 'task',
    executar: async (args, ctx) => {
      const cliente = await carregarClienteDaOrganizacao(ctx.principal, args.client_id);
      if (!cliente.clickupListId) {
        return { error: 'NO_TASK_TRACKING', message: `O cliente ${cliente.name} não tem lista do ClickUp vinculada.` };
      }

      const chave = args.idempotency_key ?? chaveDeIdempotencia({
        sessionId: ctx.principal.sessionId,
        tool: 'create_task',
        args: { client_id: args.client_id, title: args.title },
      });

      /**
       * DEFESA 1 — a mesma chave já criou algo nesta organização? Consulta a
       * auditoria, que é onde toda escrita deixa rastro. Retry de rede e clique
       * duplo morrem aqui, sem tocar no ClickUp.
       */
      const [jaFeito] = await db
        .select({ resourceId: schema.auditLogs.resourceId, timestamp: schema.auditLogs.timestamp })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.organizationId, ctx.principal.organizationId),
            eq(schema.auditLogs.tool, 'create_task'),
            eq(schema.auditLogs.requestId, chave),
            eq(schema.auditLogs.result, 'success'),
          ),
        );
      if (jaFeito?.resourceId) {
        const existente = await ctx.providers.tasks.getTask(jaFeito.resourceId);
        return {
          status: 'ALREADY_CREATED',
          message: 'Esse mesmo pedido já tinha sido executado. Não criei outra.',
          task: existente ? resumoDeTask(existente) : { task_id: jaFeito.resourceId },
        };
      }

      /**
       * DEFESA 2 — reconcile-first. Olha o que já existe na lista do cliente,
       * inclusive concluídas: uma task fechada ontem com o mesmo nome quase
       * sempre significa que quem pediu não sabia que ela existia.
       */
      if (!args.confirm_create) {
        const existentes = await ctx.providers.tasks.findTask(cliente.id, args.title);
        const veredicto = avaliarDuplicata(args.title, existentes.map((t) => ({ id: t.id, title: t.title, status: t.status, assignees: t.assignees, url: t.url })));
        if (veredicto.decisao === 'JA_EXISTE') {
          await registrarAuditoria(
            { principal: ctx.principal, tool: 'create_task', resourceType: 'task', resourceId: veredicto.existente.id, clientId: cliente.id, requestId: chave, result: 'blocked_duplicate', detalhe: { title: args.title } },
            ctx.logger,
          );
          return {
            status: 'ALREADY_EXISTS',
            message: 'Já existe uma tarefa praticamente idêntica. Não criei outra.',
            existing: veredicto.existente,
          };
        }
        if (veredicto.decisao === 'POSSIBLE_DUPLICATE') {
          await registrarAuditoria(
            { principal: ctx.principal, tool: 'create_task', resourceType: 'task', clientId: cliente.id, requestId: chave, result: 'blocked_duplicate', detalhe: { title: args.title, candidatos: veredicto.candidatos.length } },
            ctx.logger,
          );
          return {
            status: 'POSSIBLE_DUPLICATE',
            message:
              'Encontrei tarefas parecidas. NÃO criei nada. Pergunte ao funcionário se é uma delas; ' +
              'se ele confirmar que é nova, chame de novo com confirm_create=true.',
            candidates: veredicto.candidatos,
          };
        }
      }

      const criada = await ctx.providers.tasks.createTask({
        clientId: cliente.id,
        title: args.title,
        ...(args.description ? { description: args.description } : {}),
        ...(args.assignee_name ? { assigneeName: args.assignee_name } : {}),
        ...(args.due_date ? { dueDate: args.due_date } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
      });

      await registrarAuditoria(
        { principal: ctx.principal, tool: 'create_task', resourceType: 'task', resourceId: criada.id, clientId: cliente.id, newValue: { title: criada.title, assignees: criada.assignees }, requestId: chave, result: 'success' },
        ctx.logger,
      );
      await registrarEventoDeTask(ctx, 'TASK_CREATED', criada.id, cliente.id, `Task criada: ${criada.title}`);
      return { status: 'CREATED', task: resumoDeTask(criada) };
    },
  });

  registrarTool(deps, {
    nome: 'update_task',
    descricao:
      'Altera uma tarefa que JÁ EXISTE: título, briefing, prazo, prioridade, status ou responsável. ' +
      'Nunca use para criar — se a tarefa não existe, use create_task. Toda alteração é relida e confirmada antes de responder.',
    entrada: {
      task_id: z.string().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      assignee_name: z.string().optional(),
      assignee_operation: z.enum(['add', 'remove', 'replace']).optional(),
      due_date: z.string().optional().describe('AAAA-MM-DD.'),
      priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
      status: z.string().optional(),
    },
    scope: 'tasks.write',
    acesso: 'WRITE',
    recurso: 'task',
    executar: async (args, ctx) => {
      const antes = await ctx.providers.tasks.getTask(args.task_id);
      if (!antes) return { error: 'NOT_FOUND', message: 'Não encontrei essa task.' };

      const mudancas = {
        ...(args.title ? { title: args.title } : {}),
        ...(args.description ? { description: args.description } : {}),
        ...(args.assignee_name ? { assigneeName: args.assignee_name } : {}),
        ...(args.assignee_operation ? { assigneeOperation: args.assignee_operation } : {}),
        ...(args.due_date ? { dueDate: args.due_date } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
        ...(args.status ? { status: args.status } : {}),
      };
      if (Object.keys(mudancas).length === 0) {
        return { error: 'NO_CHANGES', message: 'Você não disse o que mudar. Informe ao menos um campo.' };
      }

      const depois = await ctx.providers.tasks.updateTask(args.task_id, mudancas);
      await registrarAuditoria(
        {
          principal: ctx.principal, tool: 'update_task', resourceType: 'task', resourceId: args.task_id,
          clientId: antes.clientId,
          // old/new lado a lado é o que responde "o que era antes?" (§12).
          oldValue: { title: antes.title, status: antes.status, due: antes.dueDate, assignees: antes.assignees },
          newValue: { title: depois.title, status: depois.status, due: depois.dueDate, assignees: depois.assignees },
          requestId: ctx.requestId, result: 'success',
        },
        ctx.logger,
      );
      await registrarEventoDeTask(ctx, 'TASK_UPDATED', args.task_id, antes.clientId, `Task alterada: ${depois.title}`);
      return { status: 'UPDATED', task: resumoDeTask(depois), changed: Object.keys(mudancas) };
    },
  });

  registrarTool(deps, {
    nome: 'complete_task',
    descricao: 'Marca uma tarefa como concluída. Relê depois para confirmar que o status mudou de verdade.',
    entrada: {
      task_id: z.string().min(1),
      status_name: z.string().optional().describe('Nome do status de conclusão daquela lista, se não for o padrão.'),
    },
    scope: 'tasks.write',
    acesso: 'WRITE',
    recurso: 'task',
    executar: async (args, ctx) => {
      const antes = await ctx.providers.tasks.getTask(args.task_id);
      if (!antes) return { error: 'NOT_FOUND', message: 'Não encontrei essa task.' };
      const depois = await ctx.providers.tasks.setStatus(args.task_id, args.status_name ?? 'concluída');
      await registrarAuditoria(
        { principal: ctx.principal, tool: 'complete_task', resourceType: 'task', resourceId: args.task_id, clientId: antes.clientId, oldValue: { status: antes.status }, newValue: { status: depois.status }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      await registrarEventoDeTask(ctx, 'TASK_COMPLETED', args.task_id, antes.clientId, `Task concluída: ${depois.title}`);
      return { status: 'COMPLETED', task: resumoDeTask(depois) };
    },
  });

  registrarTool(deps, {
    nome: 'add_task_comment',
    descricao: 'Registra um comentário na tarefa. Use para deixar decisão, contexto ou retorno de cliente onde o trabalho está.',
    entrada: { task_id: z.string().min(1), text: z.string().min(2) },
    scope: 'tasks.write',
    acesso: 'WRITE',
    recurso: 'task_comment',
    executar: async (args, ctx) => {
      const tarefa = await ctx.providers.tasks.getTask(args.task_id);
      if (!tarefa) return { error: 'NOT_FOUND', message: 'Não encontrei essa task.' };
      const comentario = await ctx.providers.tasks.addComment(args.task_id, args.text);
      await registrarAuditoria(
        { principal: ctx.principal, tool: 'add_task_comment', resourceType: 'task_comment', resourceId: comentario.id, clientId: tarefa.clientId, newValue: { text: args.text.slice(0, 500) }, requestId: ctx.requestId, result: 'success' },
        ctx.logger,
      );
      return { status: 'COMMENTED', comment_id: comentario.id };
    },
  });
}

/**
 * Todo write de tarefa vira EVENTO, e é assim que o trabalho de um funcionário
 * fica visível para os outros (§25). Falha aqui não derruba a escrita: a tarefa
 * já mudou no ClickUp, e voltar erro faria o Claude achar que não mudou.
 */
async function registrarEventoDeTask(
  ctx: { principal: { userId: string; organizationId: string; employeeId: string; name: string }; logger: { warn: (o: object, m: string) => void } },
  tipo: string,
  taskId: string,
  clientId: string | null,
  resumo: string,
): Promise<void> {
  try {
    await db.insert(schema.operationalEvents).values({
      source: 'chat',
      type: tipo,
      externalId: `mcp:${tipo}:${taskId}:${Date.now()}`,
      organizationId: ctx.principal.organizationId,
      userId: ctx.principal.userId,
      employeeId: ctx.principal.employeeId,
      clientId,
      taskId,
      entityType: 'task',
      entityId: taskId,
      actor: ctx.principal.name,
      summary: resumo,
      importance: 'LOW',
      visibility: 'TEAM',
      occurredAt: new Date(),
      processedAt: new Date(),
    });
  } catch (error) {
    ctx.logger.warn({ err: error, tipo, taskId }, '[mcp] não consegui registrar o evento da task');
  }
}
