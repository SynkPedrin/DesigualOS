import type { AgentStatsWire, InfrastructureHealthWire, NodeSummaryWire, SystemEventWire } from '@/lib/api/contracts';

const now = () => new Date().toISOString();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const mockNodesWire: NodeSummaryWire[] = [
  {
    node_id: 'NODE_BENTO_01',
    agent: 'bento',
    type: 'mac_mini',
    status: 'online',
    last_heartbeat_at: now(),
    cpu: 34,
    ram: 52,
    disk: 61,
    latency_ms: 42,
    gpu: null,
    vram: null,
    temperature: null,
    queue_depth: null,
  },
  {
    node_id: 'NODE_JARBAS_01',
    agent: 'jarbas',
    type: 'mac_mini',
    status: 'busy',
    last_heartbeat_at: now(),
    cpu: 71,
    ram: 68,
    disk: 55,
    latency_ms: 58,
    gpu: null,
    vram: null,
    temperature: null,
    queue_depth: null,
  },
  {
    node_id: 'NODE_SUZY_01',
    agent: 'suzy',
    type: 'mac_mini',
    status: 'online',
    last_heartbeat_at: now(),
    cpu: 22,
    ram: 41,
    disk: 48,
    latency_ms: 39,
    gpu: null,
    vram: null,
    temperature: null,
    queue_depth: null,
  },
  {
    node_id: 'NODE_STUDIO_01',
    agent: 'studio',
    type: 'gpu_server',
    status: 'rendering',
    last_heartbeat_at: now(),
    cpu: 45,
    ram: 60,
    disk: 72,
    latency_ms: 51,
    gpu: 88,
    vram: 76,
    temperature: 67,
    queue_depth: 3,
  },
];

export const mockInfrastructureHealthWire: InfrastructureHealthWire = {
  total_nodes: mockNodesWire.length,
  summary: { online: 2, warning: 0, busy: 1, degraded: 0, offline: 0, maintenance: 0, rendering: 1 },
  all_systems_online: true,
  overall_health_percent: 98,
  agents_connected: { online: 4, total: 4 },
  last_backup_at: null,
  nodes: mockNodesWire,
};

/** GET /health/events - mesmo shape do backend: desc por occurred_at, id no
 * formato NODE_<AGENTE>-<epoch ms>. */
export const mockSystemEventsWire: SystemEventWire[] = [
  {
    id: `NODE_JARBAS-${Date.now() - 6 * 60_000}`,
    occurred_at: minutesAgo(6),
    level: 'warning',
    node_label: 'Jarbas (Mac Mini 2)',
    message: 'Jarbas (Mac Mini 2) com CPU acima de 70% por mais de 5 minutos.',
  },
  {
    id: `NODE_STUDIO-${Date.now() - 15 * 60_000}`,
    occurred_at: minutesAgo(15),
    level: 'info',
    node_label: 'Studio (RTX 5090)',
    message: 'Studio (RTX 5090) entrou em renderização, fila com 3 jobs.',
  },
  {
    id: `NODE_BENTO-${Date.now() - 42 * 60_000}`,
    occurred_at: minutesAgo(42),
    level: 'error',
    node_label: 'Bento (Mac Mini 1)',
    message: 'Bento (Mac Mini 1) voltou a responder após heartbeat atrasado.',
  },
];

/** GET /agents/stats - studio com nulls de propósito, pra exercitar o '-'
 * da UI quando o backend ainda não tem base de cálculo. */
export const mockAgentStatsWire: AgentStatsWire[] = [
  { agent: 'bento', active_conversations: 2, performance_percent: 92, average_response_seconds: 1.4 },
  { agent: 'jarbas', active_conversations: 1, performance_percent: 87, average_response_seconds: 2.3 },
  { agent: 'suzy', active_conversations: 0, performance_percent: 95, average_response_seconds: 0.9 },
  { agent: 'studio', active_conversations: 1, performance_percent: null, average_response_seconds: null },
];
