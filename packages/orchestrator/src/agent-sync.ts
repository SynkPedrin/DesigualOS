import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import type { NodeStatus } from '@desigual-os/types';
import { getProbeTargets, probeAllAgents, type AgentProbeResult } from './agent-probe';
import { sendOpsAlert } from './alerts';
import { publishWsEvent } from './pubsub';

const logger = createLogger({ service: 'agent-sync' });

/**
 * Quantas rodadas seguidas sem resposta são necessárias pra declarar um
 * agente OFFLINE de verdade.
 *
 * Por que existe (estabilidade 24/7): a sonda roda a cada 10s e uma única
 * falha bastava pra pintar a máquina de offline na tela E disparar alerta
 * crítico de ops. Um handshake mais lento da Tailscale, um pico de carga na
 * máquina ou um segundo de Wi-Fi ruim viravam "o Jarbas caiu" - e logo
 * depois "voltou". Com 3 confirmações, uma queda real leva ~30s pra
 * aparecer (perfeitamente aceitável) e um soluço de rede não aparece nunca.
 * O histórico em `health_checks` continua gravando o resultado CRU de cada
 * rodada, então nada é escondido de quem for investigar depois.
 */
const OFFLINE_CONFIRMATIONS = 3;

/** Rodadas seguidas sem resposta, por node. Só vive na memória do processo:
 * reiniciou a API, começa do zero - e o pior caso disso é um agente que já
 * estava caído levar mais 30s pra ser redeclarado caído. */
const consecutiveFailures = new Map<string, number>();

/** Uma linha que a sonda mantém é atualizada a cada 10s; 10 minutos sem
 * ninguém tocar nela é sinal inequívoco de órfã, não de lentidão. */
const ORPHAN_PROBE_ROW_MAX_AGE_MS = 10 * 60_000;

/**
 * Id de cada agente por nome, em cache.
 *
 * A sonda roda a cada 10s e relia a tabela `agents` UMA VEZ POR AGENTE em
 * toda rodada - 5 consultas por ciclo, 30 por minuto, contra um Postgres
 * remoto (~130ms de ida e volta) com pool de 3 conexões, pra buscar linhas
 * que são semeadas no setup e não mudam em runtime. O TTL existe só pra que
 * um agente novo no seed apareça sem precisar reiniciar a API.
 */
const AGENT_ID_CACHE_TTL_MS = 5 * 60_000;
let agentIdCache: { ids: Map<string, string>; expiresAt: number } | null = null;

async function loadAgentIds(): Promise<Map<string, string>> {
  if (agentIdCache && agentIdCache.expiresAt > Date.now()) return agentIdCache.ids;
  const rows = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents);
  const ids = new Map(rows.map((row) => [row.name as string, row.id]));
  agentIdCache = { ids, expiresAt: Date.now() + AGENT_ID_CACHE_TTL_MS };
  return ids;
}

/**
 * Uma linha de `nodes` é lixo da sonda antiga? Critério deliberadamente
 * estreito (ver o comentário longo em autoFix): tem que ser uma linha criada
 * PELA SONDA (`version` 'probe'), que não está mais na lista de alvos, e que
 * ninguém atualiza há muito tempo. Node Agent de verdade grava a versão real
 * dele e nunca cai aqui; linha viva recebe heartbeat a cada 10s e também não.
 */
export function isOrphanProbeRow(
  node: { nodeId: string; version: string; lastHeartbeatAt: Date | null },
  knownNodeIds: ReadonlySet<string>,
  now: number = Date.now(),
): boolean {
  if (knownNodeIds.has(node.nodeId)) return false;
  if (node.version !== 'probe') return false;
  if (node.lastHeartbeatAt && node.lastHeartbeatAt.getTime() > now - ORPHAN_PROBE_ROW_MAX_AGE_MS) return false;
  return true;
}

/**
 * Que status gravar pra um node nesta rodada.
 *
 * Só declara OFFLINE depois de OFFLINE_CONFIRMATIONS rodadas seguidas sem
 * resposta (ver a constante). Enquanto não confirma, o node mantém o status
 * que já tinha - e é o "último contato" que envelhece, que é a informação
 * honesta enquanto a sonda ainda não tem certeza.
 */
export function decideNodeStatus(
  probeStatus: AgentProbeResult['status'],
  previousStatus: NodeStatus | null,
  consecutiveFailures: number,
): NodeStatus {
  if (probeStatus !== 'offline') return probeStatus;
  if (consecutiveFailures >= OFFLINE_CONFIRMATIONS) return 'offline';
  return previousStatus ?? 'offline';
}

export interface Diagnosis {
  agent: string;
  /** O que está errado, em português, pra quem lê a tela. */
  problem: string;
  /** O que dá pra fazer. `autoFixed` diz se o sistema já resolveu sozinho. */
  suggestion: string;
  autoFixed: boolean;
  severity: 'erro' | 'aviso';
}

export interface SyncReport {
  ranAt: string;
  agents: AgentProbeResult[];
  diagnoses: Diagnosis[];
  /** Quantos registros de saúde foram gravados nesta rodada. */
  recorded: number;
}

/**
 * Traduz o resultado bruto da sonda em problema + o que fazer.
 *
 * Regra: nunca inventar causa. Se o serviço não respondeu, o diagnóstico diz
 * exatamente isso e sugere o passo real - não chuta "deve ser o firewall".
 */
function diagnose(result: AgentProbeResult, offlineConfirmado: boolean): Diagnosis[] {
  const found: Diagnosis[] = [];

  if (result.status === 'offline') {
    // Falha ainda não confirmada não vira erro vermelho na tela: pode ser um
    // soluço de rede, e dizer "o Jarbas caiu" pra logo depois dizer "voltou"
    // ensina a pessoa a ignorar o painel.
    found.push(
      offlineConfirmado
        ? {
            agent: result.agent,
            problem: `${result.label} não respondeu em nenhum serviço.`,
            suggestion:
              'A máquina provavelmente está desligada, dormindo ou fora da Tailscale. ' +
              'Verifique se ela está ligada e com o Tailscale conectado.',
            autoFixed: false,
            severity: 'erro',
          }
        : {
            agent: result.agent,
            problem: `${result.label} não respondeu na última verificação.`,
            suggestion: 'Pode ser instabilidade momentânea de rede. Confirmando nas próximas verificações.',
            autoFixed: false,
            severity: 'aviso',
          },
    );
    return found;
  }

  for (const service of result.services) {
    if (service.ok) continue;
    found.push({
      agent: result.agent,
      problem: `${result.label}: o serviço "${service.name}" está fora (${service.error ?? 'motivo desconhecido'}).`,
      suggestion:
        service.error === 'máquina não respondeu'
          ? `A máquina responde em outros serviços, então "${service.name}" caiu sozinho. Reinicie esse processo na máquina.`
          : `Verifique o log de "${service.name}" na máquina do ${result.label}.`,
      autoFixed: false,
      severity: 'erro',
    });
  }

  const vram = result.metrics.vramPercent;
  if (vram !== undefined && vram >= 90) {
    found.push({
      agent: result.agent,
      problem: `VRAM da GPU em ${vram}%.`,
      suggestion:
        'Pouca memória de vídeo livre: uma geração pesada pode falhar. Considere esperar a fila esvaziar.',
      autoFixed: false,
      severity: 'aviso',
    });
  }

  const queue = result.metrics.queueDepth;
  if (queue !== undefined && queue >= 5) {
    found.push({
      agent: result.agent,
      problem: `Fila do Studio com ${queue} jobs.`,
      suggestion: 'A GPU está com acúmulo. Novas gerações vão demorar mais que o normal.',
      autoFixed: false,
      severity: 'aviso',
    });
  }

  return found;
}

/**
 * O MOTOR DE TEXTO É COMPARTILHADO, e a tela não dizia isso.
 *
 * Achado real (11/09/2026): o Bento aparecia ONLINE no painel e mesmo assim
 * não respondia nada - `POST /ask` do bento-qa devolvia
 * `502 {"error":"The operation was aborted due to timeout","elapsed_ms":30001}`
 * em toda pergunta que exigia síntese. O `/health` dele continua respondendo
 * `ok:true` porque só prova que o PROCESSO está de pé, não que ele consegue
 * pensar. O Jarbas dizia a mesma coisa com outras palavras na cara do
 * usuário: entregava os números do Meta Ads (calculados localmente) e
 * avisava que "a leitura interpretativa não saiu porque o motor de texto
 * está fora".
 *
 * A causa era uma só: o Ollama (COPY_OLLAMA_URL) roda na máquina do Studio,
 * que estava desligada. Ou seja, o painel JÁ TINHA o dado certo (Studio
 * offline) e mesmo assim ninguém conseguia ligar uma coisa na outra. Esta
 * função escreve a ligação, que é o que transforma um dado em diagnóstico.
 */
function diagnoseTextEngine(results: AgentProbeResult[]): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];

  // Sonda profunda do Bento (incidente 11-14/09/2026): bento-qa respondia
  // /health ok com o motor de texto morto, e o Monitoramento dizia "online".
  const bento = results.find((result) => result.agent === 'bento');
  if (bento?.deepCheck && !bento.deepCheck.ok) {
    diagnoses.push({
      agent: 'bento',
      problem:
        'O motor de texto do Bento está fora: o bento-qa responde saúde, mas não gera resposta ' +
        `(${bento.deepCheck.error ?? 'falha na sonda profunda'}).`,
      suggestion:
        'Na máquina do Bento: verifique o Ollama (lsof -i :11434; se preso, mate o PID e suba com `ollama serve` ou reabra o app) ' +
        'e reinicie o bento-qa (pm2 restart).',
      autoFixed: false,
      severity: 'erro',
    });
  }

  const studio = results.find((result) => result.agent === 'studio');
  if (studio) {
    const ollama = studio.services.find((service) => service.name === 'ollama');
    if (ollama && !ollama.ok) {
      diagnoses.push({
        agent: 'sistema',
        problem:
          'O motor de texto (Ollama, na máquina do Studio) está fora. Bento e Jarbas continuam de pé e ' +
          'entregam dado bruto, mas NENHUM dos dois consegue redigir resposta, briefing ou análise enquanto isso.',
        suggestion:
          'Ligue a máquina do Studio (RTX) e confirme que ela voltou à Tailscale e que o Ollama subiu. ' +
          'Enquanto ela estiver fora, uma pergunta ao Bento falha por tempo esgotado, não por estar mal formulada.',
        autoFixed: false,
        severity: 'erro',
      });
    }
  }

  return diagnoses;
}

/**
 * AUTOSSOLUÇÃO: o que o sistema conserta sozinho, sem pedir nada a ninguém.
 *
 * Deliberadamente conservador. Só entra aqui o que é seguro e reversível -
 * mexer no estado do NOSSO banco. Reiniciar processo em máquina de produção
 * NÃO entra: isso derruba atendimento real de cliente e precisa de gente
 * decidindo.
 */
async function autoFix(results: AgentProbeResult[]): Promise<Diagnosis[]> {
  const fixed: Diagnosis[] = [];

  const knownNodeIds = new Set(getProbeTargets().map((target) => target.nodeId));

  // 1. Nodes de teste apontando pra localhost poluíam o Monitoramento e
  //    faziam a saúde geral aparecer como 0%. São restos de desenvolvimento.
  const staleNodes = await db.select().from(schema.nodes);
  for (const node of staleNodes) {
    const isFakeOrTest = /FAKE|TEST/i.test(node.nodeId);
    if (!isFakeOrTest) continue;
    await db.delete(schema.nodes).where(eq(schema.nodes.id, node.id));
    fixed.push({
      agent: 'sistema',
      problem: `Node de teste "${node.nodeId}" apontando pra ${node.privateHost} poluía o Monitoramento.`,
      suggestion: 'Removido automaticamente - não representa máquina real.',
      autoFixed: true,
      severity: 'aviso',
    });
  }

  // 1b. LINHAS FANTASMA DA PRÓPRIA SONDA.
  //
  // Achado real (11/09/2026, relato "o sistema consta que os agentes estão
  // offline mas todos estão ligados"): em 10/09 os nodeIds da sonda ganharam
  // o sufixo "_01" pra bater com o heartbeat real das máquinas
  // (NODE_OTTO -> NODE_OTTO_01, idem nos outros 4). A sonda passou a manter
  // as linhas novas, mas NINGUÉM apagou as antigas - e nada no sistema varre
  // node velho. Resultado medido no banco: 10 linhas pra 5 máquinas físicas,
  // 5 delas congeladas em `offline` com heartbeat parado no dia anterior.
  // Como /health/infrastructure conta TODAS as linhas de `nodes`, o painel
  // mostrava "4 de 10 conectados / saúde 40%" e uma lista cheia de máquinas
  // caídas que na verdade estavam ligadas o tempo todo.
  //
  // O critério é estreito de propósito: só linha que a PRÓPRIA sonda criou
  // (version 'probe'), que não está mais na lista de alvos, e que ninguém
  // atualiza há muito tempo. Um Node Agent de verdade que se registra
  // sozinho grava a versão real dele e nunca cai nesta regra; uma linha que
  // a sonda mantém recebe heartbeat a cada 10s e também não cai.
  for (const node of staleNodes) {
    if (!isOrphanProbeRow(node, knownNodeIds)) continue;
    await db.delete(schema.nodes).where(eq(schema.nodes.id, node.id));
    fixed.push({
      agent: 'sistema',
      problem: `Node "${node.nodeId}" era uma linha duplicada da sonda antiga (mesma máquina de ${node.privateHost}) e aparecia como offline pra sempre no Monitoramento.`,
      suggestion: 'Removida automaticamente - a máquina continua monitorada pela linha ativa.',
      autoFixed: true,
      severity: 'aviso',
    });
  }

  // 2. Agente que voltou a responder mas continuava marcado offline no banco.
  for (const result of results) {
    if (result.status === 'offline') continue;
    const [node] = await db
      .select()
      .from(schema.nodes)
      .where(eq(schema.nodes.nodeId, result.nodeId));
    if (node && node.status === 'offline') {
      fixed.push({
        agent: result.agent,
        problem: `${result.label} estava marcado como offline no sistema, mas está respondendo.`,
        suggestion: 'Status corrigido automaticamente pela sonda.',
        autoFixed: true,
        severity: 'aviso',
      });
    }
  }

  return fixed;
}

function toNodeStatus(status: AgentProbeResult['status']): 'online' | 'offline' | 'degraded' {
  return status;
}

/**
 * Roda a sonda, grava o resultado real e devolve o diagnóstico.
 * É isto que o botão "Sincronizar" do Monitoramento dispara.
 */
export async function syncAgents(): Promise<SyncReport> {
  const results = await probeAllAgents();
  const autoFixes = await autoFix(results);

  // Contagem de rodadas seguidas sem resposta, por node: só depois de
  // OFFLINE_CONFIRMATIONS o agente é declarado caído de verdade (ver a
  // constante). Feita antes do laço de gravação porque o diagnóstico
  // mostrado na tela também precisa saber se a queda já é certeza.
  const agentIds = await loadAgentIds();
  const confirmados = new Map<string, boolean>();
  for (const result of results) {
    if (result.status === 'offline') {
      const failures = (consecutiveFailures.get(result.nodeId) ?? 0) + 1;
      consecutiveFailures.set(result.nodeId, failures);
      confirmados.set(result.nodeId, failures >= OFFLINE_CONFIRMATIONS);
    } else {
      consecutiveFailures.delete(result.nodeId);
      confirmados.set(result.nodeId, false);
    }
  }

  let recorded = 0;
  for (const result of results) {
    const agentId = agentIds.get(result.agent);
    if (!agentId) continue;

    // Upsert do node: a sonda é a fonte de verdade de quem existe de verdade.
    const [existing] = await db
      .select()
      .from(schema.nodes)
      .where(eq(schema.nodes.nodeId, result.nodeId));
    const offlineConfirmado = confirmados.get(result.nodeId) ?? false;
    // Enquanto a queda não é confirmada o node mantém o status anterior - o
    // que envelhece é o "último contato", que é a informação honesta
    // enquanto a sonda ainda não tem certeza.
    const statusGravado = decideNodeStatus(
      result.status,
      existing?.status ?? null,
      offlineConfirmado ? OFFLINE_CONFIRMATIONS : 0,
    );

    const nodeValues = {
      nodeId: result.nodeId,
      agentId,
      type: (result.agent === 'studio' ? 'gpu_server' : 'mac_mini') as 'gpu_server' | 'mac_mini',
      status: statusGravado,
      // IP real, não o rótulo de exibição (bug corrigido em 03/09/2026 - ver
      // comentário em ProbeTarget.host no agent-probe.ts).
      privateHost: result.host,
      // A sonda não instala nada nas máquinas, então não tem como ler a
      // versão do agente remoto. Registra a origem do dado em vez de
      // inventar um número de versão.
      version: 'probe',
      // `lastHeartbeatAt` só avança quando houve CONTATO de verdade. Antes
      // disto a sonda carimbava a hora atual mesmo numa rodada em que a
      // máquina não respondeu nada: o painel mostrava "último contato há 2
      // segundos" embaixo de um agente marcado offline, e o health sweep
      // (que rebaixa por heartbeat velho) nunca tinha efeito nenhum, porque
      // a própria sonda mantinha o carimbo fresco pra máquina morta.
      ...(result.status === 'offline' ? {} : { lastHeartbeatAt: new Date() }),
    };

    const nodeId = existing
      ? (
          await db
            .update(schema.nodes)
            .set(nodeValues)
            .where(eq(schema.nodes.id, existing.id))
            .returning()
        )[0]?.id
      : (await db.insert(schema.nodes).values(nodeValues).returning())[0]?.id;

    if (!nodeId) continue;

    // Alerta só na TRANSIÇÃO pra offline CONFIRMADA, nunca a cada ciclo de
    // 10s enquanto segue offline (o status anterior no banco já serve de
    // debounce natural) e nunca numa falha isolada ainda não confirmada.
    if (existing && existing.status !== 'offline' && statusGravado === 'offline') {
      await sendOpsAlert({
        severity: 'critical',
        title: `${result.label} caiu`,
        detail: `Status mudou de '${existing.status}' para 'offline'. Verifique se a máquina está ligada e com o Tailscale conectado.`,
      });
    }

    await db.insert(schema.healthChecks).values({
      nodeId,
      status: toNodeStatus(result.status),
      latencyMs: result.latencyMs,
      cpu: result.metrics.cpuPercent ?? null,
      ram: result.metrics.ramPercent ?? null,
      disk: result.metrics.diskPercent ?? null,
      gpu: result.metrics.gpuPercent ?? null,
      vram: result.metrics.vramPercent ?? null,
      temperature: result.metrics.temperature ?? null,
      queueDepth: result.metrics.queueDepth ?? null,
    });
    recorded += 1;
  }

  const diagnoses = [
    ...autoFixes,
    ...diagnoseTextEngine(results),
    ...results.flatMap((result) => diagnose(result, confirmados.get(result.nodeId) ?? false)),
  ];
  const ranAt = new Date().toISOString();
  logger.info({ recorded, problemas: diagnoses.length }, 'Sincronização de agentes concluída');

  // Avisa o Monitoramento pelo WS que tem dado novo, em vez de depender só
  // de polling. Falha aqui não pode derrubar o sync: o dado já está gravado.
  try {
    await publishWsEvent({
      type: 'node.status',
      payload: {
        online: results.filter((r) => r.status === 'online').length,
        total: results.length,
        ran_at: ranAt,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao publicar node.status no WS');
  }

  return { ranAt, agents: results, diagnoses, recorded };
}
