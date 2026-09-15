import { getTaskListId, type ClickUpConfig } from './clickup-client.js';

/**
 * write-scope.ts — cerca de escrita do ClickUp.
 *
 * Existe por causa do release gate: pra provar a autonomia do Bento é preciso
 * deixá-lo criar, editar, reatribuir e mudar prazo de verdade — mas NUNCA na
 * operação real dos clientes. A regra que o operador pediu é dura: qualquer
 * write fora da lista de QA é BLOQUEADO.
 *
 * Fica no clickup-client (e não no bento-action-guard) de propósito: a cerca
 * só vale se for impossível contorná-la. Todo caminho de escrita — guard,
 * loop agêntico, rota HTTP, automação — passa por estas funções.
 *
 * DESLIGADA POR DEFAULT: sem CLICKUP_WRITE_SCOPE_LIST_ID na env, nada muda e
 * a produção escreve normalmente. Ligar é opt-in explícito de ambiente de
 * teste. É uma trava de segurança, não uma regra de negócio.
 */

export class WriteScopeError extends Error {
  constructor(
    message: string,
    readonly attemptedListId: string | null,
    readonly allowedListId: string,
  ) {
    super(message);
    this.name = 'WriteScopeError';
  }
}

/**
 * Lista única permitida pra escrita, ou null (sem cerca).
 * CLICKUP_TEST_LIST_ID é aceito como alias porque é o nome que o operador
 * usa no .env do gate; a cerca liga com qualquer um dos dois.
 */
export function getWriteScopeListId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.CLICKUP_WRITE_SCOPE_LIST_ID?.trim() || env.CLICKUP_TEST_LIST_ID?.trim();
  return raw ? raw : null;
}

/** Cria/edita numa lista conhecida: barra quando não é a permitida. */
export function assertListInScope(listId: string, env: NodeJS.ProcessEnv = process.env): void {
  const escopo = getWriteScopeListId(env);
  if (!escopo) return;
  if (listId !== escopo) {
    throw new WriteScopeError(
      `Escrita BLOQUEADA: a lista ${listId} está fora do escopo de teste (só ${escopo} é permitida).`,
      listId,
      escopo,
    );
  }
}

/**
 * Escrita endereçada por TASK (update/delete/comentário/anexo): descobre a
 * lista da task antes de deixar passar. Custa uma leitura a mais por escrita,
 * e é o preço de não conseguir tocar em task de cliente por acidente.
 *
 * Falha ao descobrir a lista também BLOQUEIA: numa cerca de segurança, não
 * saber onde a escrita vai cair é motivo pra recusar, não pra seguir.
 */
export async function assertTaskInScope(
  config: ClickUpConfig,
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const escopo = getWriteScopeListId(env);
  if (!escopo) return;
  let listId: string;
  try {
    listId = await getTaskListId(config, taskId);
  } catch (error) {
    throw new WriteScopeError(
      `Escrita BLOQUEADA: não consegui descobrir a lista da task ${taskId} pra validar o escopo de teste (${error instanceof Error ? error.message : String(error)}).`,
      null,
      escopo,
    );
  }
  if (listId !== escopo) {
    throw new WriteScopeError(
      `Escrita BLOQUEADA: a task ${taskId} está na lista ${listId}, fora do escopo de teste (só ${escopo} é permitida).`,
      listId,
      escopo,
    );
  }
}
