import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { estagioPeloStatus } from './estagios';

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
