import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { NODE_STATUSES } from '@desigual-os/types';
import { syncAgents, getProbeTargets, readWorkerHealth } from '@desigual-os/orchestrator';
import { getReleaseInfo } from '@desigual-os/logging';
import { requireAuth, requirePermission } from '../auth/middleware';
import { separarRegistrosAposentados } from './retired-nodes';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Gerenciamento de agentes/infra é assunto de master (pedido do usuário:
  // colaborador só vê o dia a dia dele, não saúde de máquina).
  app.get('/health/infrastructure', { preHandler: [requireAuth, requirePermission('nodes', 'read')] }, async () => {
    const rows = await db
      .select({
        nodeId: schema.nodes.nodeId,
        agent: schema.agents.name,
        type: schema.nodes.type,
        status: schema.nodes.status,
        lastHeartbeatAt: schema.nodes.lastHeartbeatAt,
        internalId: schema.nodes.id,
      })
      .from(schema.nodes)
      .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id));

    // Registro antigo de máquina que trocou de NODE_ID sai da conta; máquina realmente caída
    // continua contando. A regra e o porquê estão em retired-nodes.ts, com testes.
    const { ativos, aposentados } = separarRegistrosAposentados(rows);

    const summary = Object.fromEntries(NODE_STATUSES.map((status) => [status, 0])) as Record<
      (typeof NODE_STATUSES)[number],
      number
    >;
    for (const row of ativos) {
      summary[row.status] += 1;
    }

    // Achado real (2026-09-10): "um node por vez" virou N consultas por
    // requisição (3 Macs + RTX = ~4-5 roundtrips ao Postgres remoto,
    // SEQUENCIAIS a cada chamada de /health/infrastructure). Esta rota é
    // pollada a cada 15s (use-infrastructure-health.ts) e MULTIPLICADA por
    // aba/sessão aberta - sob concorrência real (várias abas do navegador),
    // isso saturava o pool de conexões do Supabase e deixava TODA outra
    // rota que também precisa de uma conexão (conversas, notificações,
    // clientes) lenta junto, mesmo sem relação nenhuma com infraestrutura -
    // sintoma reportado como "tudo dentro do Studio demora pra abrir".
    // `selectDistinctOn` busca o health check mais recente de TODOS os
    // nodes numa única consulta, não uma por node.
    const latestHealthByNode =
      rows.length > 0
        ? await db
            .selectDistinctOn([schema.healthChecks.nodeId])
            .from(schema.healthChecks)
            .where(inArray(schema.healthChecks.nodeId, rows.map((row) => row.internalId)))
            .orderBy(schema.healthChecks.nodeId, desc(schema.healthChecks.createdAt))
        : [];
    const latestByNodeId = new Map(latestHealthByNode.map((check) => [check.nodeId, check]));

    const nodes = ativos.map((row) => {
      const latest = latestByNodeId.get(row.internalId);
      return {
        node_id: row.nodeId,
        agent: row.agent,
        type: row.type,
        status: row.status,
        last_heartbeat_at: row.lastHeartbeatAt?.toISOString() ?? null,
        cpu: latest?.cpu ?? null,
        ram: latest?.ram ?? null,
        disk: latest?.disk ?? null,
        latency_ms: latest?.latencyMs ?? null,
        // Só o Studio preenche isso de verdade (seção 7.3).
        gpu: latest?.gpu ?? null,
        vram: latest?.vram ?? null,
        temperature: latest?.temperature ?? null,
        queue_depth: latest?.queueDepth ?? null,
      };
    });

    const online = summary.online;
    const total = ativos.length;

    // O WORKER ENTRA NA CONTA. Antes esta rota só olhava a tabela `nodes` (as máquinas remotas
    // dos agentes), e o processo local que executa TODO job do sistema não aparecia. Resultado
    // medido em 10/09/2026: worker morto por 10 minutos, fila empilhando, e o painel estampando
    // "Saúde geral 100% / Todos os sistemas online". Saúde que não cobre o executor não é saúde.
    const worker = await readWorkerHealth();

    return {
      // P1-04 (release readiness audit, 22/09/2026): "não é possível
      // certificar equivalência entre web, API, worker e nodes" — este é o
      // lugar único pra comparar release_sha de API e worker lado a lado
      // (worker.release_sha abaixo) depois de um deploy.
      api_release: getReleaseInfo(),
      total_nodes: total,
      summary,
      // Curinga: nenhum node degraded/warning/offline conta como "tudo saudável" — e agora o
      // worker vale como curinga também, porque com ele fora NADA é executado, por mais que
      // todos os nodes remotos estejam de pé.
      all_systems_online: total > 0 && online === total && worker.online,
      overall_health_percent: total > 0 ? Math.round((online / total) * 100) : 0,
      agents_connected: { online, total },
      worker: {
        online: worker.online,
        pid: worker.pid,
        started_at: worker.startedAt,
        release_sha: worker.releaseSha,
        last_heartbeat_at: worker.lastBeatAt,
        seconds_since_heartbeat: worker.segundosDesdeUltimoBatimento,
        jobs_waiting: worker.jobsAguardando,
        jobs_active: worker.jobsAtivos,
        queues: worker.filas,
        diagnosis: worker.diagnostico,
      },
      // Declarado, não escondido: quem olhar a saúde vê que existem registros antigos fora da
      // conta, e quais são.
      retired_registrations: aposentados.map((row) => ({
        node_id: row.nodeId,
        agent: row.agent,
        last_heartbeat_at: row.lastHeartbeatAt?.toISOString() ?? null,
      })),
      // Não existe sistema de backup implementado ainda; nunca inventar um valor aqui.
      last_backup_at: null,
      nodes,
    };
  });

  app.get<{ Params: { node_id: string } }>(
    '/nodes/:node_id',
    { preHandler: [requireAuth, requirePermission('nodes', 'read')] },
    async (request, reply) => {
    const [node] = await db
      .select({
        nodeId: schema.nodes.nodeId,
        agent: schema.agents.name,
        type: schema.nodes.type,
        privateHost: schema.nodes.privateHost,
        version: schema.nodes.version,
        status: schema.nodes.status,
        lastHeartbeatAt: schema.nodes.lastHeartbeatAt,
        internalId: schema.nodes.id,
      })
      .from(schema.nodes)
      .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id))
      .where(eq(schema.nodes.nodeId, request.params.node_id));

    if (!node) {
      reply.code(404);
      return { error: `Node '${request.params.node_id}' not found` };
    }

    const capabilities = await db
      .select({ capability: schema.nodeCapabilities.capability })
      .from(schema.nodeCapabilities)
      .where(eq(schema.nodeCapabilities.nodeId, node.internalId));

    const [latestHealthCheck] = await db
      .select()
      .from(schema.healthChecks)
      .where(eq(schema.healthChecks.nodeId, node.internalId))
      .orderBy(desc(schema.healthChecks.createdAt))
      .limit(1);

    return {
      node_id: node.nodeId,
      agent: node.agent,
      type: node.type,
      private_host: node.privateHost,
      version: node.version,
      status: node.status,
      last_heartbeat_at: node.lastHeartbeatAt?.toISOString() ?? null,
      capabilities: capabilities.map((row) => row.capability),
      latest_metrics: latestHealthCheck
        ? {
            cpu: latestHealthCheck.cpu,
            ram: latestHealthCheck.ram,
            disk: latestHealthCheck.disk,
            gpu: latestHealthCheck.gpu,
            vram: latestHealthCheck.vram,
            temperature: latestHealthCheck.temperature,
            latency_ms: latestHealthCheck.latencyMs,
            queue_depth: latestHealthCheck.queueDepth,
            active_job: latestHealthCheck.activeJob,
            recorded_at: latestHealthCheck.createdAt.toISOString(),
          }
        : null,
    };
    },
  );
  /**
   * Botão "Sincronizar" do Monitoramento: vai ATÉ cada agente, mede de
   * verdade, grava o resultado e devolve o diagnóstico com o que já foi
   * autossolucionado. Substitui a espera passiva por heartbeat - que nunca
   * chegava, deixando a tela em "0/2 agentes conectados".
   */
  app.post('/health/sync', { preHandler: [requireAuth, requirePermission('nodes', 'read')] }, async () => {
    const report = await syncAgents();
    return {
      ran_at: report.ranAt,
      recorded: report.recorded,
      agents: report.agents.map((agent) => ({
        agent: agent.agent,
        node_id: agent.nodeId,
        label: agent.label,
        status: agent.status,
        latency_ms: agent.latencyMs,
        services: agent.services.map((s) => ({ name: s.name, ok: s.ok, http_status: s.httpStatus, error: s.error })),
        metrics: {
          ram: agent.metrics.ramPercent ?? null,
          vram: agent.metrics.vramPercent ?? null,
          queue_depth: agent.metrics.queueDepth ?? null,
        },
      })),
      diagnoses: report.diagnoses.map((d) => ({
        agent: d.agent,
        problem: d.problem,
        suggestion: d.suggestion,
        auto_fixed: d.autoFixed,
        severity: d.severity,
      })),
    };
  });
  /**
   * Linha do tempo do Monitoramento: derivada de health_checks (sem tabela
   * nova). Cada TRANSIÇÃO de status entre registros consecutivos de um mesmo
   * node vira um evento - offline vira erro, volta pro ar vira info, e
   * qualquer estado intermediário vira aviso.
   */
  app.get('/health/events', { preHandler: [requireAuth, requirePermission('nodes', 'read')] }, async () => {
    const rows = await db
      .select({
        nodeId: schema.nodes.nodeId,
        status: schema.healthChecks.status,
        createdAt: schema.healthChecks.createdAt,
      })
      .from(schema.healthChecks)
      .innerJoin(schema.nodes, eq(schema.healthChecks.nodeId, schema.nodes.id))
      .orderBy(desc(schema.healthChecks.createdAt))
      .limit(100);

    const labels = new Map(getProbeTargets().map((target) => [target.nodeId, target.label]));
    const labelFor = (nodeId: string) => labels.get(nodeId) ?? nodeId;

    // Agrupa por node mantendo a ordem (mais novo primeiro): só comparando
    // registros consecutivos do MESMO node uma transição faz sentido.
    const byNode = new Map<string, { status: string; createdAt: Date }[]>();
    for (const row of rows) {
      const list = byNode.get(row.nodeId) ?? [];
      list.push(row);
      byNode.set(row.nodeId, list);
    }

    const events: { id: string; occurred_at: string; level: 'error' | 'warning' | 'info'; node_label: string; message: string }[] = [];
    for (const [nodeId, checks] of byNode) {
      for (let i = 0; i < checks.length - 1; i += 1) {
        const newer = checks[i]!;
        const older = checks[i + 1]!;
        if (newer.status === older.status) continue;

        const label = labelFor(nodeId);
        const event =
          newer.status === 'offline'
            ? { level: 'error' as const, message: `${label} ficou offline.` }
            : newer.status === 'online'
              ? { level: 'info' as const, message: `${label} voltou a responder.` }
              : { level: 'warning' as const, message: `${label} ficou degradado.` };

        events.push({
          id: `${nodeId}-${newer.createdAt.getTime()}`,
          occurred_at: newer.createdAt.toISOString(),
          node_label: label,
          ...event,
        });
      }
    }

    events.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    return { events: events.slice(0, 20) };
  });

}
