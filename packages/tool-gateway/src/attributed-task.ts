import { createTask, findMemberByEmail, type ClickUpConfig, type CreatedTask } from './clickup-client';

export interface CreateAttributedTaskParams {
  listId: string;
  name: string;
  description?: string;
  requesterName: string;
  requesterClickUpEmail: string | null;
}

export interface AttributedTaskResult extends CreatedTask {
  assigned: boolean;
}

/**
 * Cria a tarefa e tenta atribuir ao colaborador que pediu, casando por
 * e-mail (seção Tool Gateway). Sem e-mail cadastrado ou sem membro
 * correspondente no workspace, cria mesmo assim, sem assignee, mas deixa
 * registrado na descrição quem pediu, nunca falha silenciosamente.
 */
export async function createAttributedTask(config: ClickUpConfig, params: CreateAttributedTaskParams): Promise<AttributedTaskResult> {
  let assigneeId: number | undefined;

  if (params.requesterClickUpEmail) {
    const member = await findMemberByEmail(config, params.requesterClickUpEmail);
    assigneeId = member?.id;
  }

  const description = [params.description, `Solicitado por: ${params.requesterName}`].filter(Boolean).join('\n\n');

  const task = await createTask(config, {
    listId: params.listId,
    name: params.name,
    description,
    ...(assigneeId !== undefined ? { assigneeId } : {}),
  });

  return { ...task, assigned: assigneeId !== undefined };
}
