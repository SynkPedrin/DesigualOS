import { createLogger } from '@desigual-os/logging';
import type { AgentName } from '@desigual-os/types';

const logger = createLogger({ service: 'agent-probe' });

/**
 * Sonda de saúde REAL dos agentes.
 *
 * Antes disso o Monitoramento lia `nodes`/`health_checks`, que só eram
 * preenchidos se cada máquina mandasse heartbeat - e nenhuma mandava. Estava
 * tudo "0/2 agentes conectados" com dois nodes de teste apontando pra
 * localhost. Aqui o Orchestrator vai ATÉ o agente e pergunta, em vez de
 * esperar notícia.
 *
 * Cada host é sobrescrevível por env porque o caminho muda conforme de onde
 * o Orchestrator roda: na VPS (dentro da Tailscale) são os IPs 100.x; numa
 * máquina de fora, um túnel local. O default é o IP real da tailnet.
 */

export interface ProbeTarget {
  agent: AgentName;
  nodeId: string;
  label: string;
  /**
   * IP Tailscale real da máquina (sem protocolo/porta). Guardado em
   * nodes.private_host pelo agent-sync - é dele que o worker de chat monta
   * a URL de dispatch (buildNodeUrl em execute-job.ts). Antes deste campo
   * existir, o sync gravava o `label` ali por engano ("Jarbas (Mac Mini)",
   * uma string de exibição, não um host), e o worker tentava montar
   * `http://Jarbas (Mac Mini):4001/execute` - inválido. Era por isso que o
   * chat nunca despachava nada de verdade pro Jarbas/Susy.
   */
  host: string;
  /**
   * Serviços que precisam responder pra esse agente ser considerado
   * saudável. `critical: false` marca um serviço auxiliar (monitoramento,
   * feature secundária) cuja queda sozinha NÃO pode bloquear o despacho de
   * chat pro agente - só rebaixa o status pra `degraded` (ver `probeAgent` e
   * `findHealthyNodeForAgent`, que aceita `degraded`). Serviço sem o campo é
   * crítico por padrão.
   */
  services: { name: string; url: string; expectStatus?: number[]; critical?: boolean }[];
}

function host(envVar: string, fallback: string): string {
  return process.env[envVar] ?? fallback;
}

/**
 * URL final de um serviço, com override por env.
 *
 * Existe porque o caminho até cada agente muda conforme de ONDE o
 * Orchestrator roda. Na VPS (dentro da Tailscale) o default já vale. Fora
 * dela, cada serviço pode estar atrás de um túnel numa porta local
 * diferente - e dois agentes usam a MESMA porta 3102 em máquinas
 * diferentes, então não dá pra resolver só trocando o host.
 *
 * Ex: PROBE_SUZY_SUSY_SERVICE_URL=http://localhost:13102/health
 */
function serviceUrl(agent: string, name: string, fallback: string): string {
  const key = `PROBE_${agent}_${name}_URL`.toUpperCase().replace(/-/g, '_');
  return process.env[key] ?? fallback;
}

export function getProbeTargets(): ProbeTarget[] {
  const bento = host('PROBE_BENTO_HOST', 'http://100.93.182.83');
  const suzy = host('PROBE_SUZY_HOST', 'http://100.86.237.73');
  const jarbas = host('PROBE_JARBAS_HOST', 'http://100.118.12.97');
  const studio = host('PROBE_STUDIO_HOST', 'http://100.107.198.50');
  // Diferente dos demais, o default do Otto já inclui a porta: o otto-node é
  // um Node Agent genérico (como o Studio Node), pensado pra rodar local em
  // dev, então o host completo é http://localhost:4002 e a URL do serviço
  // não acrescenta porta.
  const otto = host('PROBE_OTTO_HOST', 'http://localhost:4002');

  return [
    {
      agent: 'bento',
      nodeId: 'NODE_BENTO',
      label: 'Bento (Mac Mini)',
      host: bento.replace(/^https?:\/\//, ''),
      services: [
        // bento-qa é o único serviço que o chat/menção de verdade chama
        // (callBento em execute-job.ts, respondAsBento em bento-mention.ts) -
        // é o crítico. swarm-api e memory-api são auxiliares (busca direta no
        // vault como fallback, ver searchBentoBrain): se caírem sozinhos, o
        // Bento continua respondendo no chat normalmente, então não podem
        // derrubar o status geral pra 'offline'/bloquear o despacho.
        { name: 'bento-qa', url: serviceUrl('bento', 'bento-qa', `${bento}:8791/health`) },
        { name: 'swarm-api', url: serviceUrl('bento', 'swarm-api', `${bento}:8787/health`), critical: false },
        // memory-api exige token; 401 significa "no ar e protegida", não falha.
        { name: 'memory-api', url: serviceUrl('bento', 'memory-api', `${bento}:8790/memory/search`), expectStatus: [200, 400, 401, 405], critical: false },
      ],
    },
    {
      agent: 'suzy',
      nodeId: 'NODE_SUZY',
      label: 'Suzy (Mac Mini)',
      host: suzy.replace(/^https?:\/\//, ''),
      services: [{ name: 'susy-service', url: serviceUrl('suzy', 'susy-service', `${suzy}:3102/health`) }],
    },
    {
      agent: 'jarbas',
      nodeId: 'NODE_JARBAS',
      label: 'Jarbas (Mac Mini)',
      host: jarbas.replace(/^https?:\/\//, ''),
      services: [{ name: 'agentes-desigual', url: serviceUrl('jarbas', 'agentes-desigual', `${jarbas}:3102/health`) }],
    },
    {
      agent: 'studio',
      nodeId: 'NODE_STUDIO',
      label: 'Studio (RTX 4090)',
      host: studio.replace(/^https?:\/\//, ''),
      services: [
        { name: 'comfyui', url: serviceUrl('studio', 'comfyui', `${studio}:8188/system_stats`) },
        { name: 'ollama', url: serviceUrl('studio', 'ollama', `${studio}:11434/api/tags`) },
      ],
    },
    {
      agent: 'otto',
      nodeId: 'NODE_OTTO',
      label: 'Otto (direção criativa)',
      host: otto.replace(/^https?:\/\//, ''),
      services: [{ name: 'otto-node', url: serviceUrl('otto', 'otto-node', `${otto}/health`) }],
    },
  ];
}

export interface ServiceResult {
  name: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
}

export interface AgentProbeResult {
  agent: ProbeTarget['agent'];
  nodeId: string;
  label: string;
  host: string;
  /** online = tudo respondeu; degraded = parte respondeu; offline = nada. */
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  services: ServiceResult[];
  /** Métricas reais quando o agente sabe informar (Studio: ComfyUI + metrics server do studio-node). */
  metrics: {
    cpuPercent?: number;
    ramPercent?: number;
    diskPercent?: number;
    gpuPercent?: number;
    vramPercent?: number;
    queueDepth?: number;
    temperature?: number;
  };
}

async function probeService(service: ProbeTarget['services'][number]): Promise<ServiceResult> {
  const started = Date.now();
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(8000) });
    const accepted = service.expectStatus ?? [200];
    return {
      name: service.name,
      ok: accepted.includes(response.status),
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      error: accepted.includes(response.status) ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: service.name,
      ok: false,
      httpStatus: null,
      latencyMs: Date.now() - started,
      // "fetch failed" não diz nada pra quem lê a tela.
      error: /fetch failed|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message) ? 'máquina não respondeu' : message.slice(0, 120),
    };
  }
}

/**
 * Métricas reais da máquina do Studio. O ComfyUI expõe RAM e VRAM de
 * verdade em /system_stats, e o tamanho da fila em /queue - é o único
 * agente que hoje sabe informar isso sem instalar nada novo.
 */
async function collectStudioMetrics(baseUrl: string): Promise<AgentProbeResult['metrics']> {
  try {
    const [statsResponse, queueResponse] = await Promise.all([
      fetch(`${baseUrl}:8188/system_stats`, { signal: AbortSignal.timeout(8000) }),
      fetch(`${baseUrl}:8188/queue`, { signal: AbortSignal.timeout(8000) }),
    ]);
    if (!statsResponse.ok) return {};

    const stats = (await statsResponse.json()) as {
      system?: { ram_total?: number; ram_free?: number };
      devices?: { vram_total?: number; vram_free?: number }[];
    };
    const metrics: AgentProbeResult['metrics'] = {};

    const ramTotal = stats.system?.ram_total ?? 0;
    const ramFree = stats.system?.ram_free ?? 0;
    if (ramTotal > 0) metrics.ramPercent = Math.round(((ramTotal - ramFree) / ramTotal) * 100);

    const device = stats.devices?.[0];
    if (device?.vram_total) {
      metrics.vramPercent = Math.round(((device.vram_total - (device.vram_free ?? 0)) / device.vram_total) * 100);
      // Sem leitura de utilização de núcleo aqui: o ComfyUI não expõe. Usar
      // VRAM como proxy seria inventar um número - melhor não ter o campo.
    }

    if (queueResponse.ok) {
      const queue = (await queueResponse.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
      metrics.queueDepth = (queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0);
    }

    return metrics;
  } catch {
    return {};
  }
}

/**
 * Métricas da máquina lidas pelo metrics server do próprio studio-node
 * (nodes/studio-node/src/metrics-server.ts). É a única fonte REAL de CPU,
 * disco e temperatura da GPU server - o ComfyUI não expõe nada disso.
 * O GPU vem do nvidia-smi aqui, então tem prioridade sobre qualquer proxy.
 * Falha ou campo ausente -> {}: a sonda nunca derruba por métrica.
 */
async function collectStudioNodeMetrics(baseUrl: string): Promise<AgentProbeResult['metrics']> {
  try {
    const url = serviceUrl('studio', 'metrics', `${baseUrl}:4100/metrics`);
    const nodeSecret = process.env.NODE_SECRET;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      ...(nodeSecret ? { headers: { Authorization: `Bearer ${nodeSecret}` } } : {}),
    });
    if (!response.ok) return {};

    const body = (await response.json()) as {
      cpu?: number;
      disk?: number;
      gpu?: number | null;
      temperature?: number | null;
    };
    const metrics: AgentProbeResult['metrics'] = {};

    if (typeof body.cpu === 'number') metrics.cpuPercent = body.cpu;
    if (typeof body.disk === 'number') metrics.diskPercent = body.disk;
    if (typeof body.gpu === 'number') metrics.gpuPercent = body.gpu;
    if (typeof body.temperature === 'number') metrics.temperature = body.temperature;

    return metrics;
  } catch {
    return {};
  }
}

export async function probeAgent(target: ProbeTarget): Promise<AgentProbeResult> {
  const services = await Promise.all(target.services.map(probeService));
  const okCount = services.filter((s) => s.ok).length;

  // Status baseado em criticidade, não em contagem bruta: um serviço
  // auxiliar (critical: false) fora não pode virar 'offline' nem bloquear o
  // despacho (findHealthyNodeForAgent aceita 'degraded'). Só um serviço
  // crítico fora derruba pra 'offline'. Bug corrigido em 07/09/2026: antes
  // disso o Bento (3 serviços, só 1 crítico) caía pro chat inteiro sempre
  // que swarm-api ou memory-api saíam do ar sozinhos, mesmo com o bento-qa
  // saudável.
  const criticalServices = target.services.map((s, i) => ({ ...s, result: services[i] })).filter((s) => s.critical !== false);
  const criticalOk = criticalServices.every((s) => s.result?.ok);
  const status: AgentProbeResult['status'] = okCount === services.length ? 'online' : criticalOk ? 'degraded' : 'offline';

  let metrics: AgentProbeResult['metrics'] = {};
  if (target.agent === 'studio' && okCount > 0) {
    const studioHost = host('PROBE_STUDIO_HOST', 'http://100.107.198.50');
    // ComfyUI (RAM/VRAM/fila) e metrics server do studio-node (CPU/disco/
    // GPU/temperatura) em paralelo: um não pode atrasar o outro.
    const [comfyMetrics, nodeMetrics] = await Promise.all([
      collectStudioMetrics(studioHost),
      collectStudioNodeMetrics(studioHost),
    ]);
    metrics = {
      ...comfyMetrics,
      ...nodeMetrics,
      // VRAM e fila só o ComfyUI sabe; o spread acima nunca os apaga porque
      // collectStudioNodeMetrics não os retorna.
    };
  }

  return {
    agent: target.agent,
    nodeId: target.nodeId,
    label: target.label,
    host: target.host,
    status,
    latencyMs: Math.max(...services.map((s) => s.latencyMs)),
    services,
    metrics,
  };
}

/** Sonda todos em paralelo: um agente fora não pode atrasar a leitura dos outros. */
export async function probeAllAgents(): Promise<AgentProbeResult[]> {
  const results = await Promise.all(getProbeTargets().map(probeAgent));
  logger.info(
    { online: results.filter((r) => r.status === 'online').length, total: results.length },
    'Sonda de agentes concluída',
  );
  return results;
}
