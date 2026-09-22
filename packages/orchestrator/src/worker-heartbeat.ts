import { AGENT_NAMES } from '@desigual-os/types';
import { getReleaseInfo } from '@desigual-os/logging';
import { getAgentQueue, getRedisConnection, queueNameForAgent } from './queues';
import { AUTOMATIONS_QUEUE_NAME, getAutomationsQueue } from './automation-queue';

/**
 * worker-heartbeat.ts — sinal de vida do worker do orquestrador.
 *
 * DEFEITO QUE ISTO FECHA, medido ao vivo em 10/09/2026: o watcher do tsx matou o worker no meio
 * de um job, o processo substituto não subiu, e o worker ficou MORTO por 10 minutos. Durante
 * todo esse tempo:
 *   - o chat aceitava mensagem normalmente (a API só enfileira, ela não executa);
 *   - os jobs empilhavam no Redis sem ninguém consumir;
 *   - o usuário via "Não consegui concluir essa resposta. Tente reformular a pergunta" — texto
 *     que culpa a PERGUNTA por uma falha de INFRAESTRUTURA;
 *   - e o painel continuou estampando "Saúde geral 100% / Todos os sistemas online".
 *
 * A última linha é a mais grave: `/health/infrastructure` só olhava a tabela `nodes`, isto é,
 * as máquinas REMOTAS dos agentes. O processo local que executa TODO job do sistema não
 * aparecia em lugar nenhum da saúde. Um painel que diz "tudo online" com o worker morto é pior
 * que não ter painel, porque desliga a desconfiança de quem está operando.
 *
 * Por que Redis e não Postgres: o worker já depende do Redis pra existir (é onde as filas
 * moram). Se o Redis cair, o worker não processa nada de qualquer forma — então o batimento
 * não inventa uma dependência nova, e não custa uma escrita no banco a cada 10s. A chave tem
 * TTL: worker morto para de renovar e a chave SOME sozinha, sem precisar de ninguém marcando
 * "offline". Ausência é o sinal, e ausência é o que de fato acontece quando um processo morre.
 */

const CHAVE_BATIMENTO = 'desigual:worker:heartbeat';

/** Intervalo de escrita. TTL é 4x maior pra um GC pausado não parecer morte. */
export const BATIMENTO_INTERVALO_MS = 10_000;
const BATIMENTO_TTL_S = 40;

/** Acima disto o worker é considerado fora do ar por quem lê a saúde. */
export const BATIMENTO_LIMITE_MS = 45_000;

/** Acima disto a fila é considerada acumulando, mesmo com o worker vivo. */
export const FILA_ALTA = 20;

export interface BatimentoDoWorker {
  pid: number;
  startedAt: string;
  beatAt: string;
  version: string | null;
  /** P1-04: SHA do commit que este worker está rodando de verdade (Phase 11 da missão de release). */
  releaseSha: string;
}

/**
 * Começa a bater. Devolve a função de parada (usada no shutdown, pra não segurar o event loop).
 * `unref()` no timer é deliberado: o batimento nunca pode ser o motivo de o processo não sair.
 */
export function startWorkerHeartbeat(): () => void {
  const redis = getRedisConnection();
  const startedAt = new Date().toISOString();

  const bater = async (): Promise<void> => {
    const payload: BatimentoDoWorker = {
      pid: process.pid,
      startedAt,
      beatAt: new Date().toISOString(),
      version: process.env.npm_package_version ?? null,
      releaseSha: getReleaseInfo().release_sha,
    };
    try {
      await redis.set(CHAVE_BATIMENTO, JSON.stringify(payload), 'EX', BATIMENTO_TTL_S);
    } catch {
      // Redis fora: o batimento some sozinho por TTL e a saúde passa a acusar. Não faz sentido
      // derrubar o worker por não conseguir avisar que está vivo.
    }
  };

  void bater();
  const timer = setInterval(() => void bater(), BATIMENTO_INTERVALO_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Apaga o batimento. Chamado no shutdown limpo pra saúde refletir a parada na hora. */
export async function stopWorkerHeartbeat(): Promise<void> {
  try {
    await getRedisConnection().del(CHAVE_BATIMENTO);
  } catch {
    // Idem: TTL resolve.
  }
}

export interface ProfundidadeDaFila {
  fila: string;
  aguardando: number;
  ativos: number;
  atrasados: number;
  falhos: number;
}

export interface SaudeDoWorker {
  online: boolean;
  pid: number | null;
  startedAt: string | null;
  /** P1-04: SHA do commit que o worker vivo está rodando (null quando não há batimento). */
  releaseSha: string | null;
  lastBeatAt: string | null;
  segundosDesdeUltimoBatimento: number | null;
  /** Soma de `aguardando` em todas as filas. É o que dói pro usuário: pedido parado. */
  jobsAguardando: number;
  jobsAtivos: number;
  filas: ProfundidadeDaFila[];
  /**
   * Diagnóstico legível. Existe pra a resposta dizer O QUE está errado, em vez de devolver
   * só um booleano que quem lê precisa interpretar.
   */
  diagnostico: string;
}

/**
 * Lê a saúde do worker. Roda na API (que continua de pé quando o worker morre — é justamente
 * essa assimetria que permite detectar a morte).
 */
export async function readWorkerHealth(): Promise<SaudeDoWorker> {
  const redis = getRedisConnection();

  let batimento: BatimentoDoWorker | null = null;
  try {
    const cru = await redis.get(CHAVE_BATIMENTO);
    if (cru) batimento = JSON.parse(cru) as BatimentoDoWorker;
  } catch {
    batimento = null;
  }

  const agora = Date.now();
  const msDesde = batimento ? agora - new Date(batimento.beatAt).getTime() : null;
  const online = msDesde !== null && msDesde <= BATIMENTO_LIMITE_MS;

  const filas: ProfundidadeDaFila[] = [];
  try {
    const alvos = [
      ...AGENT_NAMES.map((agente) => ({ nome: queueNameForAgent(agente), queue: getAgentQueue(agente) })),
      { nome: AUTOMATIONS_QUEUE_NAME, queue: getAutomationsQueue() },
    ];
    for (const alvo of alvos) {
      const contagem = await alvo.queue.getJobCounts('wait', 'active', 'delayed', 'failed');
      filas.push({
        fila: alvo.nome,
        aguardando: contagem.wait ?? 0,
        ativos: contagem.active ?? 0,
        atrasados: contagem.delayed ?? 0,
        falhos: contagem.failed ?? 0,
      });
    }
  } catch {
    // Sem Redis não há como medir fila; o `online: false` abaixo já conta a história principal.
  }

  const jobsAguardando = filas.reduce((t, f) => t + f.aguardando, 0);
  const jobsAtivos = filas.reduce((t, f) => t + f.ativos, 0);

  let diagnostico: string;
  if (!online && jobsAguardando > 0) {
    diagnostico = `Worker fora do ar com ${jobsAguardando} pedido(s) na fila: ninguém está executando.`;
  } else if (!online) {
    diagnostico = 'Worker fora do ar: qualquer pedido novo vai ficar parado na fila.';
  } else if (jobsAguardando > FILA_ALTA) {
    diagnostico = `Worker de pé, mas ${jobsAguardando} pedido(s) esperando: a fila está acumulando.`;
  } else {
    diagnostico = 'Worker de pé e consumindo a fila.';
  }

  return {
    online,
    pid: batimento?.pid ?? null,
    startedAt: batimento?.startedAt ?? null,
    releaseSha: batimento?.releaseSha ?? null,
    lastBeatAt: batimento?.beatAt ?? null,
    segundosDesdeUltimoBatimento: msDesde === null ? null : Math.round(msDesde / 1000),
    jobsAguardando,
    jobsAtivos,
    filas,
    diagnostico,
  };
}
