import { createLogger } from '@desigual-os/logging';
import { getRedisConnection, publishWsEvent } from '@desigual-os/orchestrator';
import { comPrazo, escritaNoClickUpLigada } from './escrita-daily';
import { db, schema } from '@desigual-os/database';
import { and, eq, isNull } from 'drizzle-orm';
import { ClickUpHttpError, lerClickUpCru, type ClickUpConfig } from '@desigual-os/tool-gateway';
import {
  arquivarTarefaDoClickUp,
  importClickUp,
  organizacaoDaListaDoClickUp,
  parDaTarefaDoClickUp,
  tarefaDoClickUpJaImportada,
  temEscritaPendente,
  type SnapshotDoClickUp,
} from '@desigual-os/work-engine';

const logger = createLogger({ service: 'daily-sync-clickup' });

/**
 * SINCRONIA CLICKUP → DAILY TASKS, AO VIVO (28/10/2026).
 *
 * O Daily Tasks vai substituir o ClickUp. Até o dia de desligar o ClickUp, as duas telas precisam mostrar a MESMA
 * coisa: status, responsável, prazo, comentário, checklist. Esta peça lê a tarefa que mudou no ClickUp e a aplica no
 * Daily pelo MESMO importador que fez a carga inicial (idempotente, vincula por `work_external_mappings`), em modo
 * `aoVivo`, em que o que foi tirado lá também sai daqui.
 *
 * Duas entradas, de propósito:
 *   1. o webhook (instantâneo): qualquer evento `task*` agenda a releitura daquela tarefa;
 *   2. a varredura (rede de segurança, a cada minuto): relê o que mudou desde a última passada. Cobre evento perdido,
 *      webhook que não assina todos os eventos e a janela em que a API esteve fora do ar.
 *
 * Só LÊ o ClickUp. Nada é escrito lá. Desligada por padrão: `DAILY_SYNC_CLICKUP=on` liga.
 */

export function sincroniaDoDailyLigada(): boolean {
  return process.env.DAILY_SYNC_CLICKUP === 'on';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cru = any;

// ── montagem do snapshot (pura) ──────────────────────────────────────────────────────────────────────────────────

export interface PecasDoClickUp {
  membros: Cru[];
  tarefa: Cru;
  comentarios: Cru[];
  lista: Cru;
  espaco: Cru;
  camposDaLista: Cru[];
}

/** O mesmo formato dos arquivos do snapshot em disco, para uma tarefa só. */
export function montarSnapshotDaTarefa(p: PecasDoClickUp): SnapshotDoClickUp {
  const pasta = p.lista?.folder && p.lista.folder.hidden !== true ? p.lista.folder : null;
  const espacoId = String(p.espaco.id);
  return {
    team: { members: p.membros },
    spaces: [
      {
        id: espacoId,
        name: p.espaco.name,
        color: p.espaco.color ?? null,
        statuses: p.espaco.statuses ?? [],
        _archived: p.espaco.archived === true,
        _folders: pasta ? [{ id: String(pasta.id), name: pasta.name, _archived: pasta.archived === true }] : [],
      },
    ],
    lists: [
      {
        id: String(p.lista.id),
        name: p.lista.name,
        content: p.lista.content ?? null,
        _space: espacoId,
        _folder: pasta ? String(pasta.id) : null,
        _archived: p.lista.archived === true,
        _fields: p.camposDaLista,
      },
    ],
    tasks: [p.tarefa],
    extras: { [String(p.tarefa.id)]: { comments: p.comentarios, attachments: p.tarefa.attachments ?? [] } },
  };
}

// ── leitura do ClickUp (com cache do que quase não muda) ─────────────────────────────────────────────────────────

const TTL_ESTRUTURA_MS = 10 * 60_000;
const estrutura = new Map<string, { em: number; valor: unknown }>();

async function comCache<T>(chave: string, ler: () => Promise<T>): Promise<T> {
  const guardado = estrutura.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_ESTRUTURA_MS) return guardado.valor as T;
  const valor = await ler();
  estrutura.set(chave, { em: Date.now(), valor });
  return valor;
}

/** Para testes: esquece o que ficou guardado. */
export function esquecerEstruturaDoClickUp(): void {
  estrutura.clear();
}

export class SincroniaIndisponivel extends Error {}

/** A tarefa tem edição do Daily esperando para ir ao ClickUp: ler agora e aplicar por cima a apagaria. Tenta de novo logo. */
export class SincroniaAdiada extends Error {}

function configDoClickUp(): ClickUpConfig {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) throw new SincroniaIndisponivel('CLICKUP_API_KEY/CLICKUP_TEAM_ID não configurados.');
  return { apiKey, teamId };
}

export interface ResultadoDaSincronia {
  taskId: string;
  acao: 'sincronizada' | 'arquivada' | 'ignorada';
  motivo?: string;
}

/** Lê a tarefa (e o que a rodeia) no ClickUp e aplica no Daily. A fila abaixo garante uma de cada vez. */
export async function sincronizarTarefaNoDaily(taskId: string, opcoes: { apagada?: boolean; profundidade?: number } = {}): Promise<ResultadoDaSincronia> {
  if (opcoes.apagada) {
    const empresas = await arquivarTarefaDoClickUp(taskId);
    empresas.forEach(avisarDailyMudou);
    return empresas.length > 0 ? { taskId, acao: 'arquivada' } : { taskId, acao: 'ignorada', motivo: 'apagada no ClickUp e nunca importada' };
  }
  const config = configDoClickUp();

  // Edição feita aqui que ainda não chegou ao ClickUp: espera o escoador esvaziar, senão a leitura devolve o valor antigo por cima dela.
  if (escritaNoClickUpLigada()) {
    const par = await parDaTarefaDoClickUp(taskId);
    if (par && (await temEscritaPendente(par.organizationId, par.taskId))) throw new SincroniaAdiada();
  }

  let tarefa: Cru;
  try {
    tarefa = await lerClickUpCru(config, `/task/${taskId}?include_markdown_description=true&include_subtasks=false`);
  } catch (e) {
    if (e instanceof ClickUpHttpError && e.status === 404) {
      const empresas = await arquivarTarefaDoClickUp(taskId);
      empresas.forEach(avisarDailyMudou);
      return empresas.length > 0 ? { taskId, acao: 'arquivada' } : { taskId, acao: 'ignorada', motivo: 'não existe mais no ClickUp' };
    }
    throw e;
  }

  const listId = String(tarefa.list?.id ?? '');
  if (!listId) return { taskId, acao: 'ignorada', motivo: 'tarefa sem lista' };
  const organizationId = await organizacaoDaListaDoClickUp(listId);
  if (!organizationId) return { taskId, acao: 'ignorada', motivo: `lista ${listId} não pertence a nenhuma empresa daqui` };

  // Subtarefa: o pai entra antes, senão ela nasceria solta, sem pai e sem profundidade.
  const profundidade = opcoes.profundidade ?? 0;
  if (tarefa.parent && profundidade < 3 && !(await tarefaDoClickUpJaImportada(organizationId, String(tarefa.parent)))) {
    await sincronizarTarefaNoDaily(String(tarefa.parent), { profundidade: profundidade + 1 });
  }

  const espacoId = String(tarefa.space?.id ?? '');
  const [membros, lista, espaco, camposDaLista, comentarios] = await Promise.all([
    comCache('membros', async () => (await lerClickUpCru<{ team: { members: Cru[] } }>(config, `/team/${config.teamId}`)).team.members),
    comCache(`lista:${listId}`, () => lerClickUpCru<Cru>(config, `/list/${listId}`)),
    comCache(`espaco:${espacoId}`, () => lerClickUpCru<Cru>(config, `/space/${espacoId}`)),
    // Campos personalizados são um enfeite da tarefa: se a leitura falhar, a tarefa entra sem eles em vez de não entrar.
    comCache(`campos:${listId}`, async () => (await lerClickUpCru<{ fields: Cru[] }>(config, `/list/${listId}/field`).catch(() => ({ fields: [] as Cru[] }))).fields ?? []),
    lerClickUpCru<{ comments: Cru[] }>(config, `/task/${taskId}/comment`).then((r) => r.comments ?? []),
  ]);

  const snapshot = montarSnapshotDaTarefa({ membros, tarefa, comentarios, lista, espaco, camposDaLista });
  await importClickUp({ organizationId, userId: null, actorKind: 'system' }, { snapshot, aoVivo: true });
  avisarDailyMudou(organizationId);
  return { taskId, acao: 'sincronizada' };
}

// ── aviso ao vivo para as telas abertas ──────────────────────────────────────────────────────────────────────────

const AVISO_A_CADA_MS = 1_500;
const avisoPendente = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * "O Daily mudou" ao vivo. Vai para os membros ativos da empresa e não leva dado nenhum: cada tela busca de novo com
 * a própria permissão (mesmo princípio de `gestao.mudou`). Uma rajada de sincronias vira um aviso só por empresa.
 */
export function avisarDailyMudou(organizationId: string): void {
  if (process.env.VITEST || avisoPendente.has(organizationId)) return;
  const t = setTimeout(() => {
    avisoPendente.delete(organizationId);
    void (async () => {
      try {
        const membros = await db
          .select({ id: schema.users.id })
          .from(schema.organizationMembers)
          .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
          .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
        if (membros.length) await publishWsEvent({ type: 'work.mudou', payload: { recipient_ids: membros.map((m) => m.id) } });
      } catch (error) {
        logger.warn({ error }, 'Daily sync: aviso ao vivo falhou (a tela recupera no próximo refetch)');
      }
    })();
  }, AVISO_A_CADA_MS);
  t.unref?.();
  avisoPendente.set(organizationId, t);
}

// ── fila: uma sincronia por vez, e eventos da mesma tarefa em rajada viram uma só ─────────────────────────────────

const ESPERA_DA_RAJADA_MS = 1_500;

/**
 * Prazo de cada passo da fila. A fila é uma corrente de promessas: um passo que nunca termina (consulta pendurada numa
 * conexão que o pooler derrubou sem avisar) trancava TODA a entrada, webhook e varredura, até a API reiniciar, sem
 * erro nem log. Medido em produção em 28/10/2026: a entrada parou às 17:29 com a API saudável. Estourado o prazo, o
 * passo vira erro registrado e a fila segue; o que não foi aplicado volta na próxima varredura, porque o marco não
 * avança sobre ele.
 */
const PRAZO_DA_TAREFA_MS = Number(process.env.DAILY_SYNC_PRAZO_TAREFA_MS) || 120_000;
const PRAZO_DA_VARREDURA_MS = Number(process.env.DAILY_SYNC_PRAZO_VARREDURA_MS) || 300_000;

const pendentes = new Map<string, { timer: ReturnType<typeof setTimeout>; apagada: boolean }>();
let fila: Promise<unknown> = Promise.resolve();
const resultadosRecentes: Array<{ em: number; taskId: string; acao: string; motivo?: string; erro?: string }> = [];

function registrar(r: { taskId: string; acao: string; motivo?: string; erro?: string }) {
  resultadosRecentes.push({ em: Date.now(), ...r });
  if (resultadosRecentes.length > 50) resultadosRecentes.shift();
}

/** O que a sincronia fez nas últimas vezes (para diagnóstico: não guarda nada de conteúdo). */
export function ultimasSincronias() {
  return [...resultadosRecentes];
}

/**
 * Agenda a releitura de uma tarefa. O ClickUp entrega uma edição em lote como vários webhooks da MESMA tarefa em
 * segundos; esperar a rajada acabar troca N leituras por uma. Apagar ganha de qualquer outro evento da rajada.
 */
export function agendarSincroniaDaTarefa(taskId: string, evento: string, opcoes: { espera?: number; tentativa?: number } = {}): void {
  if (!sincroniaDoDailyLigada()) return;
  const apagada = evento === 'taskDeleted';
  const atual = pendentes.get(taskId);
  if (atual) clearTimeout(atual.timer);
  const apagadaFinal = apagada || (atual?.apagada ?? false);
  const timer = setTimeout(() => {
    pendentes.delete(taskId);
    fila = fila
      .then(() => comPrazo(sincronizarTarefaNoDaily(taskId, { apagada: apagadaFinal }), PRAZO_DA_TAREFA_MS, `a tarefa ${taskId}`))
      .then((r) => { registrar(r); if (r.acao === 'ignorada') logger.debug({ ...r }, 'Daily sync: ignorada'); })
      .catch((error: unknown) => {
        const tentativa = opcoes.tentativa ?? 0;
        if (error instanceof SincroniaAdiada && tentativa < 12) {
          agendarSincroniaDaTarefa(taskId, apagadaFinal ? 'taskDeleted' : 'adiada', { espera: 5_000, tentativa: tentativa + 1 });
          return;
        }
        registrar({ taskId, acao: 'erro', erro: error instanceof Error ? error.message : String(error) });
        logger.warn({ error, taskId }, 'Daily sync: falhou ao sincronizar a tarefa');
      });
  }, opcoes.espera ?? ESPERA_DA_RAJADA_MS);
  timer.unref?.();
  pendentes.set(taskId, { timer, apagada: apagadaFinal });
}

// ── varredura de segurança ───────────────────────────────────────────────────────────────────────────────────────

const CHAVE_DO_MARCO = 'daily-sync:clickup:marco';
const POR_PASSADA = 40;
let marcoEmMemoria = 0;

async function lerMarco(): Promise<number> {
  try {
    const v = await getRedisConnection().get(CHAVE_DO_MARCO);
    if (v) return Number(v);
  } catch { /* sem Redis: usa a memória */ }
  return marcoEmMemoria || Date.now() - 10 * 60_000;
}
async function gravarMarco(ms: number): Promise<void> {
  marcoEmMemoria = ms;
  try { await getRedisConnection().set(CHAVE_DO_MARCO, String(ms)); } catch { /* idem */ }
}

/**
 * Uma passada: as tarefas alteradas desde o marco, da mais antiga para a mais nova, até `POR_PASSADA`. O marco só
 * avança até a última tarefa PROCESSADA, então o que sobrar fica para a próxima passada.
 */
export async function varrerAlteracoesDoClickUp(): Promise<{ lidas: number; resultados: ResultadoDaSincronia[] }> {
  const config = configDoClickUp();
  const marco = await lerMarco();
  // Lê até 5 páginas (500 tarefas) e ordena aqui: não confio na ordem em que o ClickUp devolve, e o marco só pode
  // avançar sobre o que foi de fato processado, da mais antiga para a mais nova.
  const todas: Array<{ id: string; date_updated?: string }> = [];
  for (let pagina = 0; pagina < 5; pagina++) {
    const r = await lerClickUpCru<{ tasks: Array<{ id: string; date_updated?: string }> }>(
      config,
      `/team/${config.teamId}/task?date_updated_gt=${marco}&include_closed=true&subtasks=true&order_by=updated&page=${pagina}`,
    );
    todas.push(...(r.tasks ?? []));
    if ((r.tasks ?? []).length < 100) break;
  }
  const alteradas = todas.sort((a, b) => Number(a.date_updated ?? 0) - Number(b.date_updated ?? 0)).slice(0, POR_PASSADA);
  const resultados: ResultadoDaSincronia[] = [];
  let novoMarco = marco;
  for (const t of alteradas) {
    try {
      const r = await comPrazo(sincronizarTarefaNoDaily(t.id), PRAZO_DA_TAREFA_MS, `a tarefa ${t.id}`);
      resultados.push(r);
      registrar(r); // o que a varredura ignora também aparece no diagnóstico, não só o que veio por webhook
      novoMarco = Math.max(novoMarco, Number(t.date_updated ?? 0));
    } catch (error) {
      logger.warn({ error, taskId: t.id }, 'Daily sync: varredura não conseguiu uma tarefa; tenta de novo na próxima passada');
      break;
    }
  }
  if (novoMarco > marco) await gravarMarco(novoMarco);
  return { lidas: alteradas.length, resultados };
}

let varreduraLigada = false;
/** Liga a varredura (a cada minuto) se a sincronia estiver ligada. Idempotente; não roda em teste. */
export function iniciarVarreduraDoDaily(): void {
  if (varreduraLigada || process.env.VITEST || !sincroniaDoDailyLigada()) return;
  varreduraLigada = true;
  let rodando = false;
  setInterval(() => {
    if (rodando) return;
    rodando = true;
    fila = fila
      .then(() => comPrazo(varrerAlteracoesDoClickUp(), PRAZO_DA_VARREDURA_MS, 'a varredura'))
      .then((v) => { if (v.lidas > 0) logger.info({ lidas: v.lidas }, 'Daily sync: varredura aplicou alterações'); })
      .catch((error: unknown) => logger.warn({ error }, 'Daily sync: varredura falhou'))
      .finally(() => { rodando = false; });
  }, 60_000).unref();
  logger.info('Daily sync: varredura ligada (a cada 60 s)');
}
