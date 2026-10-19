import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { estagioPeloStatus } from './estagios';
import { categoriaDoStatus, estagioDaCategoria } from './quadro-geral';

/**
 * sincronizar-webhook.ts — o lado "ClickUp manda, o quadro de tarefas obedece"
 * do pedido do Pedro (13/10/2026): "toda task nova dentro do clickup é
 * adicionada automaticamente dentro [da pipeline]... quando ela muda de
 * pipeline muda o status e ele gerencia todo o clickup".
 *
 * Chamado pelo webhook do ClickUp (apps/api/src/clickup/routes.ts,
 * handleTaskChanged) depois que ele já resolveu o cliente da task — nunca
 * sozinho, porque decidir "de qual cliente é esta task" não é problema deste
 * módulo.
 *
 * Três eventos, três reações, nenhuma inventa estado:
 *   taskCreated -> cria cartão, SE o status atual bate com alguma coluna do
 *                  quadro (igual sincronizar-tarefas em bulk: status fora do
 *                  que a pessoa escolheu como coluna fica de fora).
 *   taskUpdated -> só REPOSICIONA um cartão que já existe. Nunca cria: uma
 *                  task antiga (de antes do quadro existir) que só agora
 *                  mudou de status não deveria aparecer do nada — isso é
 *                  trabalho do botão "Sincronizar tarefas" (backfill
 *                  explícito), não de um evento incidental.
 *   taskDeleted -> apaga (soft delete) o cartão correspondente, se houver.
 */
export async function sincronizarCartaoDaTarefa(params: {
  evento: 'taskCreated' | 'taskUpdated' | 'taskDeleted';
  clientId: string;
  taskId: string;
  taskName: string | null;
  statusAtual: string | null;
}): Promise<void> {
  // O quadro geral é complemento: falha nele não pode impedir que os quadros
  // do próprio cliente acompanhem a tarefa.
  await sincronizarNoQuadroGeral(params).catch(() => undefined);

  const quadros = await db
    .select()
    .from(schema.pipelineBoards)
    .where(and(eq(schema.pipelineBoards.tipo, 'tarefas'), eq(schema.pipelineBoards.clientId, params.clientId), isNull(schema.pipelineBoards.deletedAt)));

  if (quadros.length === 0) return;

  for (const quadro of quadros) {
    const [cartao] = await db
      .select({ id: schema.pipelineCards.id, stageId: schema.pipelineCards.stageId })
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), eq(schema.pipelineCards.clickupTaskId, params.taskId), isNull(schema.pipelineCards.deletedAt)));

    if (params.evento === 'taskDeleted') {
      if (cartao) await db.update(schema.pipelineCards).set({ deletedAt: new Date() }).where(eq(schema.pipelineCards.id, cartao.id));
      continue;
    }

    const estagio = estagioPeloStatus(quadro.stages, params.statusAtual);

    if (cartao) {
      // Reposiciona só quando o status mudou de verdade pra uma coluna
      // DIFERENTE da atual — update sem necessidade é update que algum
      // listener de "mudou" (ex.: auditoria futura) teria que filtrar de volta.
      if (estagio && estagio.id !== cartao.stageId) {
        await db.update(schema.pipelineCards).set({ stageId: estagio.id }).where(eq(schema.pipelineCards.id, cartao.id));
      }
      continue;
    }

    if (params.evento !== 'taskCreated' || !estagio) continue;

    // Corrida rara (dois webhooks da mesma task criada quase juntos): o
    // índice único (board_id, clickup_task_id) garante que só um cartão
    // nasce; o outro cai aqui e é ignorado, não é falha de verdade.
    await db
      .insert(schema.pipelineCards)
      .values({ boardId: quadro.id, stageId: estagio.id, name: params.taskName ?? 'Tarefa sem nome', clickupTaskId: params.taskId })
      .onConflictDoNothing();
  }
}

/**
 * O QUADRO GERAL DA AGÊNCIA também acompanha o webhook (15/10/2026): sem isto
 * ele só mudava ao clicar em Sincronizar. É o quadro de tarefas sem cliente e
 * sem dono da empresa do cliente; a coluna sai da categoria do status — só o
 * nome, que é o que o webhook traz (ver quadro-geral.ts).
 */
async function sincronizarNoQuadroGeral(params: {
  evento: 'taskCreated' | 'taskUpdated' | 'taskDeleted';
  clientId: string;
  taskId: string;
  taskName: string | null;
  statusAtual: string | null;
}): Promise<void> {
  const [cliente] = await db
    .select({ organizationId: schema.clients.organizationId, environment: schema.clients.environment })
    .from(schema.clients)
    .where(eq(schema.clients.id, params.clientId));
  if (!cliente?.organizationId || cliente.environment !== 'production') return;

  const gerais = await db
    .select()
    .from(schema.pipelineBoards)
    .where(
      and(
        eq(schema.pipelineBoards.organizationId, cliente.organizationId),
        eq(schema.pipelineBoards.tipo, 'tarefas'),
        isNull(schema.pipelineBoards.clientId),
        isNull(schema.pipelineBoards.ownerId),
        isNull(schema.pipelineBoards.deletedAt),
      ),
    );

  for (const quadro of gerais) {
    // Só quadro já convertido em categorias (a primeira sincronização faz isso).
    const estagio = estagioDaCategoria(quadro.stages, categoriaDoStatus(params.statusAtual, null));
    if (!estagio) continue;
    const [cartao] = await db
      .select({ id: schema.pipelineCards.id, stageId: schema.pipelineCards.stageId })
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), eq(schema.pipelineCards.clickupTaskId, params.taskId), isNull(schema.pipelineCards.deletedAt)));

    if (params.evento === 'taskDeleted') {
      if (cartao) await db.update(schema.pipelineCards).set({ deletedAt: new Date() }).where(eq(schema.pipelineCards.id, cartao.id));
      continue;
    }
    if (cartao) {
      if (estagio.id !== cartao.stageId) await db.update(schema.pipelineCards).set({ stageId: estagio.id }).where(eq(schema.pipelineCards.id, cartao.id));
      continue;
    }
    if (params.evento !== 'taskCreated') continue;
    await db
      .insert(schema.pipelineCards)
      .values({ boardId: quadro.id, stageId: estagio.id, name: params.taskName ?? 'Tarefa sem nome', clickupTaskId: params.taskId, clientId: params.clientId })
      .onConflictDoNothing();
  }
}
