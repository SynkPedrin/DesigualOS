import { createLogger } from '@desigual-os/logging';
import {
  addTaskTag,
  createTask,
  createTaskComment,
  getTeamMembers,
  podeEscreverEmProducao,
  removeTaskTag,
  updateTask,
  WriteScopeError,
  type ClickUpConfig,
  type ClickUpMember,
  type UpdateTaskParams,
} from '@desigual-os/tool-gateway';
import {
  comentarioParaSaida,
  cursorDaSaidaExiste,
  eventosParaSaida,
  gravarCursorDaSaida,
  iniciarCursorDaSaida,
  organizacoesComClickUp,
  registrarVinculoDeSaida,
  tarefaParaSaida,
  usuariosParaSaida,
  vinculoDaLista,
  vinculoDaTarefa,
  vinculoDoComentario,
  type EventoDeSaida,
  type TarefaParaSaida,
} from '@desigual-os/work-engine';

const logger = createLogger({ service: 'daily-sync-clickup-saida' });

/**
 * ESCRITA DE VOLTA: DAILY TASKS → CLICKUP (28/10/2026).
 *
 * Sem isto, a sincronia só de entrada é uma armadilha: alguém marca a tarefa como pronta no Daily, outra pessoa
 * comenta a mesma tarefa no ClickUp, a próxima leitura devolve o status antigo e a edição some. Enquanto o ClickUp
 * existir, o que se faz no Daily tem que chegar lá.
 *
 * COMO: lê a trilha `work_activity_events` (que registra TODA mudança, dentro da transação dela) a partir de um
 * cursor durável por empresa, e para cada evento empurra o valor de AGORA do que mudou. Os mesmos freios de sempre
 * valem para tudo que sai daqui, porque as funções de escrita do ClickUp os aplicam por dentro: o interruptor
 * `BENTO_WRITE_ENABLED=false` e a cerca por lista de teste (`CLICKUP_WRITE_SCOPE_LIST_ID`/`CLICKUP_TEST_LIST_ID`).
 * A cerca é a trava de homologação do Bento, e em produção ela está ligada: só a edição de uma PESSOA a atravessa
 * (ver `configDoEvento`). Agente e automação continuam escrevendo só na lista de teste.
 *
 * O QUE VAI: criar tarefa, título, descrição, status, prioridade, prazo, início, estimativa, etiquetas,
 * responsáveis e comentários novos. O QUE NÃO VAI, de propósito: apagar, arquivar e mover (nada destrutivo sai
 * daqui), anexos e campos personalizados (sem equivalente simples de escrita ainda).
 *
 * Falha passageira (rede, 5xx, 429) PARA a fila e tenta de novo no próximo ciclo, sem perder nada. Falha definitiva
 * (4xx, cerca de teste) é registrada e pulada, senão um evento ruim trancaria todos os que vêm depois dele.
 *
 * Desligada por padrão: `DAILY_SYNC_CLICKUP_ESCRITA=on` liga.
 */

export function escritaNoClickUpLigada(): boolean {
  return process.env.DAILY_SYNC_CLICKUP_ESCRITA === 'on';
}

function configDoClickUp(): ClickUpConfig | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  return apiKey && teamId ? { apiKey, teamId } : null;
}

export interface ResultadoDaEscrita {
  lidos: number;
  empurrados: number;
  ignorados: number;
  falhas: number;
  paradaPor?: string;
}

/** Falha que passa sozinha (rede fora, ClickUp instável, limite de taxa) versus a que não adianta repetir. */
export function falhaPassageira(error: unknown): boolean {
  if (error instanceof WriteScopeError) return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (/n[ãa]o respondeu|timeout|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) return true;
  const status = /\((\d{3})\)/.exec(msg)?.[1];
  if (status) return status === '429' || status.startsWith('5');
  return error instanceof TypeError; // fetch lança TypeError quando a rede cai
}

export class SincroniaTravada extends Error {}
/** Corre `passo` com prazo: estourado, rejeita com `SincroniaTravada` (o passo pendurado fica para trás, a fila segue). */
export function comPrazo<T>(passo: Promise<T>, ms: number, oQue: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new SincroniaTravada(`${oQue} passou de ${Math.round(ms / 1000)} s sem terminar`)), ms);
    timer.unref?.();
  });
  return Promise.race([passo, estouro]).finally(() => clearTimeout(timer));
}

// ── membros do ClickUp (para casar responsável por e-mail) ───────────────────────────────────────────────────────

let membrosEmCache: { em: number; membros: ClickUpMember[] } | null = null;
async function membrosDoClickUp(config: ClickUpConfig): Promise<ClickUpMember[]> {
  if (membrosEmCache && Date.now() - membrosEmCache.em < 10 * 60_000) return membrosEmCache.membros;
  const membros = await getTeamMembers(config);
  membrosEmCache = { em: Date.now(), membros };
  return membros;
}
export function esquecerMembrosDaEscrita(): void {
  membrosEmCache = null;
}

/** ids do ClickUp das pessoas do Daily. Quem não casa por e-mail igual fica de fora (melhor sem responsável que na pessoa errada). */
async function idsNoClickUp(config: ClickUpConfig, userIds: string[]): Promise<number[]> {
  if (!userIds.length) return [];
  const [usuarios, membros] = await Promise.all([usuariosParaSaida(userIds), membrosDoClickUp(config)]);
  const ids: number[] = [];
  for (const id of userIds) {
    const u = usuarios.get(id);
    const emails = [u?.clickupEmail, u?.email].filter(Boolean).map((e) => e!.trim().toLowerCase());
    const membro = membros.find((m) => emails.includes(m.email.toLowerCase()));
    if (membro) ids.push(membro.id);
    else logger.debug({ userId: id }, 'Escrita Daily→ClickUp: responsável sem par no ClickUp, não enviado');
  }
  return ids;
}

/**
 * A edição de uma pessoa no Daily é justamente o que esta sincronia existe para levar ao ClickUp; com a cerca ligada,
 * ela era recusada como "fora do escopo de teste" e se perdia (medido em produção em 28/10/2026). Abre a mesma válvula
 * das escritas humanas do Bento, pelo mesmo portão (`podeEscreverEmProducao`): allowlist de emergência, se houver, e o
 * bot de QA nunca. Sem cliente de QA aqui, o bot fica sempre cercado. O interruptor `BENTO_WRITE_ENABLED` vale antes.
 */
async function configDoEvento(config: ClickUpConfig, e: EventoDeSaida): Promise<ClickUpConfig> {
  if (e.actorKind !== 'user' || !e.actorId) return config;
  const autor = (await usuariosParaSaida([e.actorId])).get(e.actorId);
  if (!autor || !podeEscreverEmProducao({ userEmail: autor.email, clientName: null })) return config;
  return { ...config, writeScope: { authorizedForProduction: true } };
}

// ── tradução do estado do Daily para o formato do ClickUp ────────────────────────────────────────────────────────

const prioridadeNoClickUp = (p: number): 1 | 2 | 3 | 4 | null => (p >= 1 && p <= 4 ? (p as 1 | 2 | 3 | 4) : null);

/** Só os campos que o evento diz que mudaram, com o valor que a tarefa tem AGORA. */
export function paramsDosCampos(t: TarefaParaSaida, campos: string[]): UpdateTaskParams {
  const p: UpdateTaskParams = {};
  for (const c of campos) {
    if (c === 'title') p.name = t.title;
    else if (c === 'description') p.markdownDescription = t.description ?? '';
    else if (c === 'priority') p.priority = prioridadeNoClickUp(t.priority);
    else if (c === 'startAt') p.startDate = t.startAt ? t.startAt.getTime() : null;
    else if (c === 'dueAt') { p.dueDate = t.dueAt ? t.dueAt.getTime() : null; p.dueDateTime = false; }
    else if (c === 'estimateMinutes') p.timeEstimate = t.estimateMinutes === null ? null : t.estimateMinutes * 60_000;
  }
  return p;
}

// ── um evento ────────────────────────────────────────────────────────────────────────────────────────────────────

type Efeito = 'empurrado' | 'ignorado';

async function criarNoClickUp(config: ClickUpConfig, org: string, e: EventoDeSaida): Promise<Efeito> {
  const t = await tarefaParaSaida(org, e.taskId);
  if (!t || t.archivedAt) return 'ignorado';
  if (await vinculoDaTarefa(org, t.id)) return 'ignorado'; // já tem par (veio do ClickUp ou já foi criada)
  const lista = await vinculoDaLista(org, t.listId);
  if (!lista) return 'ignorado'; // lista que nasceu no Daily: a tarefa fica só aqui
  let pai: string | undefined;
  if (t.parentTaskId) {
    const v = await vinculoDaTarefa(org, t.parentTaskId);
    if (!v) return 'ignorado'; // o pai é só do Daily
    pai = v.externalId;
  }
  const [primeiro, ...demais] = await idsNoClickUp(config, t.assigneeIds);
  const criada = await createTask(config, {
    listId: lista.externalId,
    name: t.title,
    ...(t.description ? { markdownDescription: t.description } : {}),
    ...(prioridadeNoClickUp(t.priority) ? { priority: prioridadeNoClickUp(t.priority)! } : {}),
    ...(t.dueAt ? { dueDate: t.dueAt.getTime(), dueDateTime: false } : {}),
    ...(t.startAt ? { startDate: t.startAt.getTime() } : {}),
    ...(pai ? { parent: pai } : {}),
    ...(primeiro !== undefined ? { assigneeId: primeiro } : {}),
  });
  // Logo depois de criar: o vínculo é o que impede a leitura (o webhook de "tarefa criada" que vem aí) de duplicar.
  await registrarVinculoDeSaida(org, { externalType: 'task', externalId: criada.id, entityId: t.id, meta: { url: criada.url } });
  // O resto é acabamento: se falhar, a tarefa já existe nos dois lados e o próximo evento corrige.
  const acabamento: UpdateTaskParams = { status: t.statusName, ...(demais.length ? { addAssignees: demais } : {}), ...(t.estimateMinutes !== null ? { timeEstimate: t.estimateMinutes * 60_000 } : {}) };
  await updateTask(config, criada.id, acabamento).catch((error: unknown) => logger.warn({ error, taskId: t.id }, 'Escrita Daily→ClickUp: tarefa criada, mas o acabamento (status/responsáveis) falhou'));
  for (const tag of t.tags) await addTaskTag(config, criada.id, tag).catch((error: unknown) => logger.warn({ error, tag }, 'Escrita Daily→ClickUp: etiqueta não aplicada (precisa existir no espaço)'));
  return 'empurrado';
}

async function aplicarEvento(config: ClickUpConfig, org: string, e: EventoDeSaida, jaFeito: Set<string>): Promise<Efeito> {
  if (e.action === 'created') return criarNoClickUp(config, org, e);

  const vinculo = await vinculoDaTarefa(org, e.taskId);
  if (!vinculo) return 'ignorado'; // tarefa só do Daily
  const ext = vinculo.externalId;

  if (e.action === 'commented') {
    const commentId = typeof e.data.commentId === 'string' ? e.data.commentId : null;
    if (!commentId || (await vinculoDoComentario(org, commentId))) return 'ignorado';
    const c = await comentarioParaSaida(org, commentId);
    if (!c) return 'ignorado';
    const autor = c.authorId ? (await usuariosParaSaida([c.authorId])).get(c.authorId)?.name : null;
    // O comentário sai com a conta do sistema; o nome de quem escreveu vai na frente para quem lê no ClickUp.
    const criado = await createTaskComment(config, ext, `${autor ?? c.authorLabel ?? 'Daily Tasks'}: ${c.body}`);
    await registrarVinculoDeSaida(org, { externalType: 'comment', externalId: criado.id, entityId: c.id });
    return 'empurrado';
  }

  const t = await tarefaParaSaida(org, e.taskId);
  if (!t) return 'ignorado';

  if (e.action === 'status_changed') {
    const chave = `${e.taskId}|status|${t.statusName}`;
    if (jaFeito.has(chave)) return 'ignorado';
    await updateTask(config, ext, { status: t.statusName });
    jaFeito.add(chave);
    return 'empurrado';
  }

  if (e.action === 'assigned' || e.action === 'unassigned') {
    const ids = await idsNoClickUp(config, Array.isArray(e.data.userIds) ? (e.data.userIds as string[]) : []);
    if (!ids.length) return 'ignorado';
    await updateTask(config, ext, e.action === 'assigned' ? { addAssignees: ids } : { removeAssignees: ids });
    return 'empurrado';
  }

  if (e.action === 'updated') {
    const mudancas = (e.data.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const params = paramsDosCampos(t, Object.keys(mudancas));
    let fez = false;
    if (Object.keys(params).length) {
      const chave = `${e.taskId}|${JSON.stringify(params)}`;
      if (!jaFeito.has(chave)) {
        await updateTask(config, ext, params);
        jaFeito.add(chave);
        fez = true;
      }
    }
    if (mudancas.tags) {
      const de = new Set(Array.isArray(mudancas.tags.from) ? (mudancas.tags.from as string[]) : []);
      const para = new Set(Array.isArray(mudancas.tags.to) ? (mudancas.tags.to as string[]) : []);
      for (const tag of para) if (!de.has(tag)) { await addTaskTag(config, ext, tag); fez = true; }
      for (const tag of de) if (!para.has(tag)) { await removeTaskTag(config, ext, tag); fez = true; }
    }
    return fez ? 'empurrado' : 'ignorado';
  }

  return 'ignorado';
}

// ── um ciclo, por empresa ────────────────────────────────────────────────────────────────────────────────────────

const resultadosRecentes: Array<{ em: number; organizationId: string; acao: string; ok: boolean; erro?: string; passageira?: boolean }> = [];
function registrar(r: { organizationId: string; acao: string; ok: boolean; erro?: string; passageira?: boolean }) {
  resultadosRecentes.push({ em: Date.now(), ...r });
  if (resultadosRecentes.length > 50) resultadosRecentes.shift();
}
/** O que a escrita fez nas últimas vezes (diagnóstico; sem conteúdo de tarefa). */
export function ultimasEscritas() {
  return [...resultadosRecentes];
}

/**
 * Empurra os eventos novos de UMA empresa. O cursor só anda sobre o que foi resolvido (empurrado, ignorado ou falha
 * definitiva): uma falha passageira para o ciclo ali e o próximo ciclo recomeça do mesmo evento.
 */
export async function empurrarEventosDaEmpresa(organizationId: string, lote = 100): Promise<ResultadoDaEscrita> {
  const r: ResultadoDaEscrita = { lidos: 0, empurrados: 0, ignorados: 0, falhas: 0 };
  const config = configDoClickUp();
  if (!config) return { ...r, paradaPor: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID não configurados' };
  if (!(await cursorDaSaidaExiste(organizationId))) {
    await iniciarCursorDaSaida(organizationId); // primeira vez: começa de agora, nunca reenvia o passado
    return r;
  }
  const eventos = await eventosParaSaida(organizationId, lote);
  r.lidos = eventos.length;
  const jaFeito = new Set<string>();
  let ultimoResolvido: EventoDeSaida | null = null;
  for (const e of eventos) {
    try {
      const efeito = await aplicarEvento(await configDoEvento(config, e), organizationId, e, jaFeito);
      if (efeito === 'empurrado') { r.empurrados++; registrar({ organizationId, acao: e.action, ok: true }); } else r.ignorados++;
    } catch (error) {
      const passageira = falhaPassageira(error);
      const erro = error instanceof Error ? error.message : String(error);
      registrar({ organizationId, acao: e.action, ok: false, erro: erro.slice(0, 300), passageira });
      if (passageira) {
        r.paradaPor = erro.slice(0, 200);
        logger.warn({ error, evento: e.id }, 'Escrita Daily→ClickUp: falha passageira, tenta de novo no próximo ciclo');
        break;
      }
      r.falhas++;
      logger.warn({ error, evento: e.id, acao: e.action }, 'Escrita Daily→ClickUp: falha definitiva neste evento, pulado');
    }
    ultimoResolvido = e;
  }
  if (ultimoResolvido) await gravarCursorDaSaida(organizationId, ultimoResolvido);
  return r;
}

const PRAZO_DO_CICLO_MS = Number(process.env.DAILY_SYNC_PRAZO_TAREFA_MS) || 120_000;
let escoadorLigado = false;
/** Liga o escoador (a cada 5 s) se a escrita estiver ligada. Idempotente; não roda em teste. */
export function iniciarEscoadorDoDaily(): void {
  if (escoadorLigado || process.env.VITEST || !escritaNoClickUpLigada()) return;
  escoadorLigado = true;
  let rodando = false;
  setInterval(() => {
    if (rodando) return;
    rodando = true;
    void (async () => {
      try {
        for (const org of await organizacoesComClickUp()) {
          // Com prazo: um ciclo pendurado deixaria `rodando` preso em true e a saída parada para sempre.
          const r = await comPrazo(empurrarEventosDaEmpresa(org), PRAZO_DO_CICLO_MS, 'o ciclo da escrita');
          if (r.empurrados || r.falhas) logger.info({ org, ...r }, 'Escrita Daily→ClickUp: ciclo');
        }
      } catch (error) {
        logger.warn({ error }, 'Escrita Daily→ClickUp: ciclo falhou');
      } finally {
        rodando = false;
      }
    })();
  }, 5_000).unref();
  logger.info('Escrita Daily→ClickUp: escoador ligado (a cada 5 s)');
}
