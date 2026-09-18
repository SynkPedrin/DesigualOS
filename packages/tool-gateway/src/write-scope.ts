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
 * KILL SWITCH — volta o Bento para READ ONLY em um passo.
 *
 * Mora aqui, e não no guard, pela MESMA razão que a cerca de lista: uma trava
 * de emergência que dá pra contornar não é uma trava. As seis funções de
 * escrita do ClickUp passam por `assertListInScope`/`assertTaskInScope`, então
 * desligar aqui desliga todas — guard, loop agêntico, rota HTTP e automação.
 *
 * LIGADO por default: unset não muda nada, que é o comportamento esperado de
 * qualquer ambiente que já existe. Desligar é explícito:
 *
 *   BENTO_WRITE_ENABLED=false  + restart do worker
 *
 * Rollback do canary é isso, e só isso. Não precisa de deploy, revert nem
 * migração — o que importa numa emergência é o número de passos.
 */
const DESLIGADO = new Set(['false', '0', 'off', 'no', 'nao', 'não']);

export function bentoWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.BENTO_WRITE_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return !DESLIGADO.has(raw);
}

/** Barra qualquer escrita quando o kill switch está desligado. */
export function assertWriteEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (bentoWriteEnabled(env)) return;
  throw new WriteScopeError(
    'Escrita DESLIGADA: BENTO_WRITE_ENABLED está off. Nenhuma alteração foi feita no ClickUp.',
    null,
    'kill-switch',
  );
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
  assertWriteEnabled(env);
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
  assertWriteEnabled(env);
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
