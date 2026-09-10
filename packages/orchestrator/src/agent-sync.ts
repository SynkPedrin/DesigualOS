import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { probeAllAgents, type AgentProbeResult } from './agent-probe';
import { sendOpsAlert } from './alerts';
import { publishWsEvent } from './pubsub';

const logger = createLogger({ service: 'agent-sync' });

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
function diagnose(result: AgentProbeResult): Diagnosis[] {
  const found: Diagnosis[] = [];

  if (result.status === 'offline') {
    found.push({
      agent: result.agent,
      problem: `${result.label} não respondeu em nenhum serviço.`,
      suggestion:
        'A máquina provavelmente está desligada, dormindo ou fora da Tailscale. ' +
        'Verifique se ela está ligada e com o Tailscale conectado.',
      autoFixed: false,
      severity: 'erro',
    });
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
 * AUTOSSOLUÇÃO: o que o sistema conserta sozinho, sem pedir nada a ninguém.
 *
 * Deliberadamente conservador. Só entra aqui o que é seguro e reversível -
 * mexer no estado do NOSSO banco. Reiniciar processo em máquina de produção
 * NÃO entra: isso derruba atendimento real de cliente e precisa de gente
 * decidindo.
 */
async function autoFix(results: AgentProbeResult[]): Promise<Diagnosis[]> {
  const fixed: Diagnosis[] = [];

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

  let recorded = 0;
  for (const result of results) {
    const [agentRow] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, result.agent));
    if (!agentRow) continue;

    // Upsert do node: a sonda é a fonte de verdade de quem existe de verdade.
    const [existing] = await db
      .select()
      .from(schema.nodes)
      .where(eq(schema.nodes.nodeId, result.nodeId));
    const nodeValues = {
      nodeId: result.nodeId,
      agentId: agentRow.id,
      type: (result.agent === 'studio' ? 'gpu_server' : 'mac_mini') as 'gpu_server' | 'mac_mini',
      status: toNodeStatus(result.status),
      // IP real, não o rótulo de exibição (bug corrigido em 03/09/2026 - ver
      // comentário em ProbeTarget.host no agent-probe.ts).
      privateHost: result.host,
      // A sonda não instala nada nas máquinas, então não tem como ler a
      // versão do agente remoto. Registra a origem do dado em vez de
      // inventar um número de versão.
      version: 'probe',
      lastHeartbeatAt: new Date(),
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

    // Alerta só na TRANSIÇÃO pra offline, nunca a cada ciclo de 10s enquanto
    // segue offline: o próprio banco (status anterior antes do update acima)
    // já serve de debounce natural, sem precisar de estado extra pra isso.
    if (existing && existing.status !== 'offline' && result.status === 'offline') {
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

  const diagnoses = [...autoFixes, ...results.flatMap(diagnose)];
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
