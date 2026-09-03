import type {
  CostByAgentWire,
  CostByClientWire,
  CostByUserWire,
  CostsOverviewWire,
} from '@/lib/api/contracts';
import { AGENT_NAMES } from '@desigual-os/types';
import { executionStore } from './executions';
import { mockClients } from './clients';

function parseRangeDays(range: string | null): number {
  const match = /^(\d+)d$/.exec(range ?? '7d');
  return match ? Number(match[1]) : 7;
}

export function buildCostsOverview(range: string | null): CostsOverviewWire {
  const rangeDays = parseRangeDays(range);
  const executions = Array.from(executionStore.values()).filter((e) => e.actual_cost !== null);

  return {
    range_days: rangeDays,
    total_cost_usd: Number(executions.reduce((sum, e) => sum + (e.actual_cost ?? 0), 0).toFixed(6)),
    cost_events: executions.length,
    total_input_tokens: executions.reduce((sum, e) => sum + e.tokens_input, 0),
    total_output_tokens: executions.reduce((sum, e) => sum + e.tokens_output, 0),
    note:
      'Custo aproximado: modelo real usado pelo OpenClaw ainda não é reportado (ver Fase 04). Ver packages/token-engine.',
  };
}

export function buildCostsByAgent(): { by_agent: CostByAgentWire[] } {
  const executions = Array.from(executionStore.values()).filter((e) => e.actual_cost !== null);
  const byAgent = AGENT_NAMES.map((agent) => {
    const forAgent = executions.filter((e) => e.agent === agent);
    return {
      agent,
      total_cost_usd: Number(forAgent.reduce((sum, e) => sum + (e.actual_cost ?? 0), 0).toFixed(6)),
      events: forAgent.length,
    };
  }).filter((row) => row.events > 0);

  return { by_agent: byAgent };
}

/**
 * Executions don't carry client_id (confirmed, see docs/api-gaps.md), so this cannot be
 * derived from executionStore honestly. Seeded independently instead of faked as derived.
 */
export function buildCostsByClient(): { by_client: CostByClientWire[] } {
  const [first, second] = mockClients;
  return {
    by_client: [
      ...(first ? [{ client_id: first.id, client_name: first.name, total_cost_usd: 0.00021 }] : []),
      ...(second ? [{ client_id: second.id, client_name: second.name, total_cost_usd: 0.00014 }] : []),
      { client_id: null, client_name: null, total_cost_usd: 0.00006 },
    ],
  };
}

export function buildCostsByUser(): { by_user: CostByUserWire[] } {
  return {
    by_user: [
      { user_id: 'user-admin-master', user_name: 'Instituto Almada', total_cost_usd: 0.00033 },
    ],
  };
}
