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

/**
 * `authorizedForProduction` é a válvula de escape ESTRUTURAL prevista pra
 * promoção de homologação pra produção (23/09/2026): quando `true`, esta
 * cerca de lista deixa de valer PARA ESTA CHAMADA, porque quem chamou já
 * provou, rio acima (`bento-action-guard.ts`), que a pessoa é humana,
 * autenticada, tem `clickup:write` pela RBAC e a organização do cliente-alvo
 * bate com a dela. A cerca nunca é o único portão pra essa população — é
 * redundante de propósito.
 *
 * Continua impossível de contornar por quem NÃO passou por aquele portão:
 * o valor só chega aqui dentro de `ClickUpConfig.writeScope` (createTask) ou
 * pela mesma origem (`assertTaskInScope`), nunca de um parâmetro que uma
 * rota HTTP, automação ou o bot de QA possa setar sozinho. O bot de QA em
 * especial NUNCA recebe esse `true` (ver `podeEscreverEmProducao` +
 * `ehQaBot`) — pra ele a cerca de lista continua a única linha de defesa
 * pra "esse cliente é mesmo o de QA?", e por isso tem que continuar valendo.
 */
export function assertListInScope(
  listId: string,
  env: NodeJS.ProcessEnv = process.env,
  authorizedForProduction = false,
): void {
  assertWriteEnabled(env);
  const escopo = getWriteScopeListId(env);
  if (!escopo) return;
  if (authorizedForProduction) return;
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
  if (config.writeScope?.authorizedForProduction) return;
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

// ── Portão de produção: quem pode atravessar a cerca ─────────────────────────────
//
// CÓPIA da regra de `apps/worker/src/processors/bento-action-guard.ts`, para o
// Daily Tasks (API) decidir igual ao Bento quando a edição de uma pessoa sai
// para o ClickUp. O guard ainda tem a sua própria porque 15 arquivos de teste do
// worker simulam este pacote inteiro e quebrariam com a troca. Mudou a regra lá,
// mude aqui (e vice-versa).

/**
 * ALLOWLIST DE EMERGÊNCIA — nariz de cera opcional, não é mais o portão
 * principal de produção (esse virou capacidade/papel, já checado antes de
 * chegar aqui via `seniorToolContext.permissions`). Continua existindo só
 * pra operação poder estreitar o raio na mão sem deploy de código, do jeito
 * que fez durante a homologação:
 *
 *   BENTO_WRITE_ALLOWLIST=tammy@institutoalmada.org
 *
 * Vazio/unset (padrão de produção) = a allowlist não filtra ninguém; quem
 * chegou até aqui já provou capacidade (`clickup:write`) e organização.
 */
export function bentoWriteAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.BENTO_WRITE_ALLOWLIST?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0));
}

/**
 * IDENTIDADE DO BOT DE QA — não é papel nem organização, é uma conta fixa de
 * teste automatizado. O raio dela é sempre o cliente de QA, nunca a carteira
 * real, e essa restrição é estrutural: não depende da allowlist de
 * emergência estar configurada ou não.
 */
export function ehQaBot(email: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const configurado = (env.BENTO_QA_BOT_EMAIL ?? 'qa-bot@institutoalmada.org').trim().toLowerCase();
  return email !== null && email.toLowerCase() === configurado;
}

function ehClienteDeQa(clientName: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const configurado = (env.BENTO_QA_CLIENT_NAME ?? 'Cliente Teste 7').trim().toLowerCase();
  return typeof clientName === 'string' && clientName.trim().toLowerCase() === configurado;
}

/**
 * PORTÃO DE PRODUÇÃO — substitui o allowlist fixo de homologação por
 * papel/capacidade real (achado no aceite: `super@institutoalmada.org`
 * tinha `clickup:write` pela RBAC e mesmo assim era recusado só por não
 * estar no allowlist por e-mail).
 *
 * Nesta altura da chamada, `seniorToolContext.permissions` já garantiu
 * capacidade (`clickup:write`, via papel master/colaborador) e
 * `loadSeniorRuntimeContext` já garantiu organização (o `organizationId`
 * resolvido bateu com uma membership do usuário) — cross-tenant já morreu
 * antes daqui. O que falta checar aqui é só:
 *
 *   1. allowlist de emergência, SE estiver configurada (operação estreitando
 *      o raio na mão);
 *   2. bot de QA só escreve no cliente de QA, nunca na carteira real —
 *      mesmo tendo a mesma capacidade RBAC que qualquer colaborador.
 */
export function podeEscreverEmProducao(
  params: { userEmail: string | null; clientName?: string | null | undefined },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const lista = bentoWriteAllowlist(env);
  if (lista.size > 0 && (params.userEmail === null || !lista.has(params.userEmail.toLowerCase()))) {
    return false;
  }
  if (ehQaBot(params.userEmail, env)) return ehClienteDeQa(params.clientName, env);
  return true;
}
