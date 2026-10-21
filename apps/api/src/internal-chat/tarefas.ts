import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createTask, findMemberByEmail, WriteScopeError } from '@desigual-os/tool-gateway';
import type { AuthenticatedUser } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';
import { AcessoNegado, DadoInvalido, SemPermissao, UUID, type Conversa } from './service';

/**
 * CRIAR TAREFA A PARTIR DE MENSAGEM (Hub 2.0).
 *
 * Idempotente: (pessoa, idempotency_key) é único em internal_task_creations.
 * O mesmo clique repetido devolve a tarefa já criada, e não cria outra no
 * ClickUp. `status` só vira 'created' depois que o ClickUp devolveu o id: a
 * tela nunca diz "criada" antes disso.
 *
 * A escrita vai com `authorizedForProduction`, como no Pipeline: é uma PESSOA
 * que preencheu e confirmou o formulário. A cerca de lista de teste
 * (CLICKUP_TEST_LIST_ID) continua valendo para escrita autônoma de agente.
 */

export class TarefaEmAndamento extends Error {
  constructor() {
    super('Essa tarefa já está sendo criada. Aguarde um instante.');
    this.name = 'TarefaEmAndamento';
  }
}

export interface PedidoDeTarefa {
  idempotencyKey: string;
  title: string;
  description?: string | null | undefined;
  clientId: string;
  assigneeClickupId?: number | null | undefined;
  dueDate?: number | null | undefined;
  priority?: 1 | 2 | 3 | 4 | null | undefined;
}

export interface TarefaCriada {
  taskId: string;
  url: string;
  clientId: string;
  clientName: string;
  replay: boolean;
}

function configDoClickUp() {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId, writeScope: { authorizedForProduction: true } };
}

export async function criarTarefaDaMensagem(
  user: AuthenticatedUser,
  conversa: Pick<Conversa, 'id' | 'organizationId'>,
  mensagem: { id: string; content: string | null },
  pedido: PedidoDeTarefa,
  linkDaMensagem: string,
): Promise<TarefaCriada> {
  const titulo = pedido.title.trim();
  if (titulo.length < 3) throw new DadoInvalido('Dê um título à tarefa.');
  if (!UUID.test(pedido.clientId)) throw new DadoInvalido('Escolha o cliente da tarefa.');
  const [cliente] = await db.select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, pedido.clientId), eq(schema.clients.organizationId, conversa.organizationId), isNull(schema.clients.deletedAt))).limit(1);
  if (!cliente || !(await hasClientAccess(user, cliente.id))) throw new AcessoNegado('Cliente não encontrado.');
  if (!cliente.listId) throw new DadoInvalido(`${cliente.name} não tem lista no ClickUp vinculada.`);
  const config = configDoClickUp();
  if (!config) throw new DadoInvalido('O ClickUp não está configurado neste servidor.');

  // Reserva a chave ANTES de chamar o ClickUp.
  const [reservada] = await db.insert(schema.internalTaskCreations).values({
    organizationId: conversa.organizationId, userId: user.id, messageId: mensagem.id, idempotencyKey: pedido.idempotencyKey, status: 'pending',
  }).onConflictDoNothing().returning();
  let registro = reservada;
  if (!registro) {
    const [existente] = await db.select().from(schema.internalTaskCreations)
      .where(and(eq(schema.internalTaskCreations.userId, user.id), eq(schema.internalTaskCreations.idempotencyKey, pedido.idempotencyKey))).limit(1);
    if (existente?.status === 'created' && existente.clickupTaskId) {
      return { taskId: existente.clickupTaskId, url: existente.clickupTaskUrl ?? `https://app.clickup.com/t/${existente.clickupTaskId}`, clientId: cliente.id, clientName: cliente.name, replay: true };
    }
    // Falhou antes (ou ficou presa há mais de 1 min): retoma com a MESMA chave.
    // A retomada é atômica — dois cliques simultâneos não retomam os dois.
    const [retomada] = await db.update(schema.internalTaskCreations).set({ status: 'pending', error: null, updatedAt: new Date() })
      .where(and(
        eq(schema.internalTaskCreations.id, existente!.id),
        sql`(${schema.internalTaskCreations.status} = 'failed' or (${schema.internalTaskCreations.status} = 'pending' and ${schema.internalTaskCreations.updatedAt} < now() - interval '60 seconds'))`,
      )).returning();
    if (!retomada) {
      const [agora] = await db.select().from(schema.internalTaskCreations).where(eq(schema.internalTaskCreations.id, existente!.id)).limit(1);
      if (agora?.status === 'created' && agora.clickupTaskId) {
        return { taskId: agora.clickupTaskId, url: agora.clickupTaskUrl ?? `https://app.clickup.com/t/${agora.clickupTaskId}`, clientId: cliente.id, clientName: cliente.name, replay: true };
      }
      throw new TarefaEmAndamento();
    }
    registro = retomada;
  }

  try {
    const [pessoa] = await db.select({ name: schema.users.name, clickupEmail: schema.users.clickupEmail }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
    let assigneeId = pedido.assigneeClickupId ?? undefined;
    if (assigneeId === undefined && pessoa?.clickupEmail) assigneeId = (await findMemberByEmail(config, pessoa.clickupEmail).catch(() => null))?.id;
    const descricao = [
      pedido.description?.trim(),
      mensagem.content ? `Mensagem de origem:\n> ${mensagem.content.slice(0, 1500).split('\n').join('\n> ')}` : null,
      `Criada a partir da Comunicação do Desigual OS: ${linkDaMensagem}`,
      `Solicitado por: ${pessoa?.name ?? user.email}`,
    ].filter(Boolean).join('\n\n');
    const criada = await createTask(config, {
      listId: cliente.listId,
      name: titulo.slice(0, 250),
      description: descricao,
      ...(assigneeId !== undefined ? { assigneeId } : {}),
      ...(pedido.priority ? { priority: pedido.priority } : {}),
      ...(pedido.dueDate ? { dueDate: pedido.dueDate } : {}),
    });
    await db.update(schema.internalTaskCreations).set({ status: 'created', clickupTaskId: criada.id, clickupTaskUrl: criada.url, updatedAt: new Date() })
      .where(eq(schema.internalTaskCreations.id, registro!.id));
    await db.insert(schema.auditLogs).values({
      userId: user.id, organizationId: conversa.organizationId, action: 'clickup.task_created', result: 'completed', source: 'app',
      metadata: { origem: 'comunicacao', message_id: mensagem.id, task_id: criada.id, list_id: cliente.listId, client_id: cliente.id },
    });
    return { taskId: criada.id, url: criada.url, clientId: cliente.id, clientName: cliente.name, replay: false };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message.slice(0, 500) : String(erro);
    await db.update(schema.internalTaskCreations).set({ status: 'failed', error: motivo, updatedAt: new Date() }).where(eq(schema.internalTaskCreations.id, registro!.id));
    if (erro instanceof WriteScopeError) throw new SemPermissao(erro.message);
    throw new DadoInvalido(`O ClickUp recusou a criação: ${motivo}`);
  }
}
