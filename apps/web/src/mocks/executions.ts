import type { AgentName } from '@desigual-os/types';
import type { ChatAgentHint, ExecutionDetailWire } from '@/lib/api/contracts';
import { mockClients } from './clients';

let executionSeq = 747558;

export function nextExecutionId(): string {
  executionSeq += 1;
  return `EXE-2026-${executionSeq}`;
}

/** Plain strings, confirmed by the backend (2026-09-01): Obsidian file paths, ClickUp tasks, etc. */
const AGENT_SOURCES: Record<AgentName, string[]> = {
  bento: ['ClickUp Tarefa #1284', '02 - Stack Tecnologica.md'],
  jarbas: ['Meta Ads Dashboard', 'ClickUp Tarefa #1301'],
  suzy: ['Instagram DM', 'ClickUp Tarefa #1190'],
  studio: ['Brand Kit: Cliente', 'ClickUp Tarefa #1322'],
};

const AGENT_ANSWER_TEMPLATES: Record<AgentName, (message: string) => string> = {
  bento: (message) =>
    `Verifiquei a documentação institucional e o histórico de tarefas relacionadas a "${message}". O status atual está registrado no ClickUp, sem pendências críticas em aberto.`,
  jarbas: (message) =>
    `Analisei as campanhas ativas relacionadas a "${message}". O CPA está dentro da meta e o ROAS acumulado do período segue estável, dá pra escalar o orçamento com segurança.`,
  suzy: (message) =>
    `Revisei as conversas recentes sobre "${message}". Sugiro um follow-up em até 24h para os leads mais quentes, o padrão de resposta do Instagram indica maior conversão nesse intervalo.`,
  studio: (message) =>
    `Preparei um briefing de criativo para "${message}" usando o Brand Kit do cliente. Recomendo três variações de carrossel para teste A/B.`,
};

/** Naive keyword router mimicking AUTO, mirrors the concept the real AI Router applies. */
export function resolveAgent(hint: ChatAgentHint, message: string): AgentName {
  if (hint !== 'AUTO') return hint.toLowerCase() as AgentName;
  const text = message.toLowerCase();
  if (/(campanha|anúncio|meta ads|cpa|roas|orçamento)/.test(text)) return 'jarbas';
  if (/(lead|venda|dm|instagram|follow.?up)/.test(text)) return 'suzy';
  if (/(criativo|carrossel|reel|vídeo|imagem)/.test(text)) return 'studio';
  return 'bento';
}

function randomBetween(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

/** Rough blended USD/token rate matching the magnitude the backend's real cost engine
 * reports (~$0.00033 for 270 tokens). Actual pricing lives in packages/token-engine. */
const COST_PER_TOKEN_USD = 0.0000012;

function computeCost(tokensInput: number, tokensOutput: number) {
  const actual = (tokensInput + tokensOutput) * COST_PER_TOKEN_USD;
  const estimated = actual * (0.9 + Math.random() * 0.2);
  return { estimated: Number(estimated.toFixed(6)), actual: Number(actual.toFixed(6)) };
}

function isoMinutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function buildSeedExecution(
  agent: AgentName,
  intent: string,
  status: ExecutionDetailWire['status'],
  priority: ExecutionDetailWire['priority'],
  startedMinutesAgo: number,
  durationSeconds: number,
  clientId: string | null,
): ExecutionDetailWire {
  const startedAt = isoMinutesAgo(startedMinutesAgo);
  const completed = status === 'completed' || status === 'failed';
  const completedAt = completed
    ? new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()
    : null;
  const tokensInput = randomBetween(30, 120);
  const tokensOutput = completed ? randomBetween(60, 400) : 0;
  const cost = status === 'completed' ? computeCost(tokensInput, tokensOutput) : null;

  return {
    execution_id: nextExecutionId(),
    agent,
    client_id: clientId,
    intent,
    status,
    priority,
    started_at: startedAt,
    completed_at: completedAt,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    estimated_cost: cost?.estimated ?? null,
    actual_cost: cost?.actual ?? null,
    steps: completed
      ? [
          {
            step_index: 0,
            agent,
            status,
            output:
              status === 'completed'
                ? {
                    answer: AGENT_ANSWER_TEMPLATES[agent](intent.replace(/_/g, ' ')),
                    sources: AGENT_SOURCES[agent],
                  }
                : null,
          },
        ]
      : [],
  };
}

const SEED_PLAN: Array<{
  agent: AgentName;
  intent: string;
  status: ExecutionDetailWire['status'];
  priority: ExecutionDetailWire['priority'];
  startedMinutesAgo: number;
  durationSeconds: number;
  clientIndex: number | null;
}> = [
  { agent: 'jarbas', intent: 'campaign_report', status: 'completed', priority: 'P1', startedMinutesAgo: 12, durationSeconds: 8, clientIndex: 0 },
  { agent: 'suzy', intent: 'lead_followup', status: 'completed', priority: 'P2', startedMinutesAgo: 45, durationSeconds: 6, clientIndex: 1 },
  { agent: 'bento', intent: 'faq_answer', status: 'completed', priority: 'P3', startedMinutesAgo: 70, durationSeconds: 4, clientIndex: null },
  { agent: 'studio', intent: 'creative_brief', status: 'completed', priority: 'P1', startedMinutesAgo: 130, durationSeconds: 22, clientIndex: 2 },
  { agent: 'jarbas', intent: 'budget_analysis', status: 'running', priority: 'P0', startedMinutesAgo: 2, durationSeconds: 0, clientIndex: 0 },
  { agent: 'bento', intent: 'document_summary', status: 'completed', priority: 'P2', startedMinutesAgo: 200, durationSeconds: 5, clientIndex: null },
  { agent: 'suzy', intent: 'dm_reply_draft', status: 'failed', priority: 'P2', startedMinutesAgo: 260, durationSeconds: 3, clientIndex: 1 },
  { agent: 'jarbas', intent: 'campaign_creation', status: 'completed', priority: 'P1', startedMinutesAgo: 340, durationSeconds: 15, clientIndex: 0 },
  { agent: 'studio', intent: 'asset_variation', status: 'completed', priority: 'P2', startedMinutesAgo: 420, durationSeconds: 34, clientIndex: 3 },
  { agent: 'bento', intent: 'task_status', status: 'completed', priority: 'P3', startedMinutesAgo: 500, durationSeconds: 3, clientIndex: null },
  { agent: 'suzy', intent: 'content_suggestion', status: 'completed', priority: 'P2', startedMinutesAgo: 600, durationSeconds: 7, clientIndex: 1 },
  { agent: 'jarbas', intent: 'campaign_report', status: 'completed', priority: 'P1', startedMinutesAgo: 720, durationSeconds: 9, clientIndex: 0 },
  { agent: 'bento', intent: 'faq_answer', status: 'completed', priority: 'P3', startedMinutesAgo: 1500, durationSeconds: 4, clientIndex: null },
  { agent: 'suzy', intent: 'lead_followup', status: 'completed', priority: 'P2', startedMinutesAgo: 1560, durationSeconds: 6, clientIndex: 1 },
  { agent: 'jarbas', intent: 'campaign_creation', status: 'completed', priority: 'P1', startedMinutesAgo: 2900, durationSeconds: 16, clientIndex: 0 },
  { agent: 'studio', intent: 'asset_variation', status: 'completed', priority: 'P2', startedMinutesAgo: 2950, durationSeconds: 28, clientIndex: 2 },
  { agent: 'bento', intent: 'document_summary', status: 'completed', priority: 'P2', startedMinutesAgo: 4300, durationSeconds: 5, clientIndex: null },
  { agent: 'suzy', intent: 'content_suggestion', status: 'completed', priority: 'P2', startedMinutesAgo: 5800, durationSeconds: 7, clientIndex: 1 },
  { agent: 'jarbas', intent: 'budget_analysis', status: 'completed', priority: 'P0', startedMinutesAgo: 5850, durationSeconds: 11, clientIndex: 0 },
];

export const executionStore = new Map<string, ExecutionDetailWire>(
  SEED_PLAN.map((plan) => {
    const execution = buildSeedExecution(
      plan.agent,
      plan.intent,
      plan.status,
      plan.priority,
      plan.startedMinutesAgo,
      plan.durationSeconds,
      plan.clientIndex !== null ? (mockClients[plan.clientIndex]?.id ?? null) : null,
    );
    return [execution.execution_id, execution];
  }),
);

export function createQueuedExecution(
  agent: AgentName,
  message: string,
  clientId: string | null,
  onCompleted?: (answer: string) => void,
): ExecutionDetailWire {
  const execution: ExecutionDetailWire = {
    execution_id: nextExecutionId(),
    agent,
    client_id: clientId,
    intent: 'chat_message',
    status: 'queued',
    priority: 'P1',
    started_at: new Date().toISOString(),
    completed_at: null,
    tokens_input: Math.max(8, Math.round(message.length / 4)),
    tokens_output: 0,
    estimated_cost: null,
    actual_cost: null,
    steps: [],
  };
  executionStore.set(execution.execution_id, execution);
  simulateProgress(execution.execution_id, agent, message, onCompleted);
  return execution;
}

function simulateProgress(
  executionId: string,
  agent: AgentName,
  message: string,
  onCompleted?: (answer: string) => void,
) {
  setTimeout(() => {
    const execution = executionStore.get(executionId);
    if (!execution) return;
    execution.status = 'running';
  }, 900);

  setTimeout(() => {
    const execution = executionStore.get(executionId);
    if (!execution) return;
    execution.status = 'completed';
    execution.completed_at = new Date().toISOString();
    execution.tokens_output = randomBetween(80, 320);
    const cost = computeCost(execution.tokens_input, execution.tokens_output);
    execution.estimated_cost = cost.estimated;
    execution.actual_cost = cost.actual;
    const answer = AGENT_ANSWER_TEMPLATES[agent](message);
    execution.steps = [
      {
        step_index: 0,
        agent,
        status: 'completed',
        output: { answer, sources: AGENT_SOURCES[agent] },
      },
    ];
    onCompleted?.(answer);
  }, 2600);
}
