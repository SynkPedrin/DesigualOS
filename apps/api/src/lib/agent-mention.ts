/**
 * Resposta a menções @Jarbas/@Suzy/@Otto no ClickUp, espelhando o fluxo do
 * Bento (bento-mention.ts): o webhook chama, a gente busca o texto real do
 * comentário, pergunta pro agente real e devolve o texto pronto pra postar
 * na thread. Falha é honesta: diz o motivo em vez de chutar.
 *
 * Jarbas/Suzy falam o protocolo POST /internal/ask do agentes-desigual (a
 * mesma rota que o Chat central usa, ver callAgentesDesigual em
 * apps/worker/src/processors/execute-job.ts). Otto NÃO fala esse protocolo -
 * ele é um Node Agent genérico (POST /execute, descoberto via
 * findHealthyNodeForAgent/schema.nodes, ver callNode no mesmo arquivo). Até
 * 07/09/2026 o Otto não tinha fluxo de menção nenhum aqui: @otto num
 * comentário do ClickUp simplesmente não disparava resposta.
 */
import { askAgent } from '@desigual-os/tool-gateway';
import type { AgentAskError } from '@desigual-os/tool-gateway';
import { AGENT_TIMEOUT_MS, findHealthyNodeForAgent } from '@desigual-os/orchestrator';
import { executeResponseSchema } from '@desigual-os/node-protocol';
import { withPersonality } from '@desigual-os/types';
import { fetchClickUpCommentText } from './bento-mention';

const AGENT_LABEL = { jarbas: 'Jarbas', suzy: 'Suzy' } as const;
const DEFAULT_URL = {
  jarbas: 'http://100.118.12.97:3102',
  suzy: 'http://100.86.237.73:3102',
} as const;

// Mesma convenção de porta padrão dos Node Agents genéricos usada em
// execute-job.ts (buildNodeUrl) - duplicada aqui de propósito: é uma
// constante de protocolo, não uma lógica de negócio que valha a pena
// compartilhar entre api e worker por um pacote novo.
const DEFAULT_NODE_PORT = 4001;

function buildNodeUrl(privateHost: string): string {
  return privateHost.includes(':') ? `http://${privateHost}` : `http://${privateHost}:${DEFAULT_NODE_PORT}`;
}

export type MentionedAgent = keyof typeof AGENT_LABEL;

/** Detecta a primeira menção a um agente no texto plano do comentário. */
export function detectMentionedAgent(text: string): MentionedAgent | 'bento' | 'otto' | null {
  const match = text.match(/@(bento|jarbas|suzy|otto)\b/i);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() as MentionedAgent | 'bento' | 'otto';
}

export async function respondAsAgent(agent: MentionedAgent, params: { taskId: string; commentId: string }): Promise<string | null> {
  const question = await fetchClickUpCommentText(params.taskId, params.commentId);
  const token = process.env.AGENTES_ASK_TOKEN;
  if (!token) {
    return `Não consegui chamar ${AGENT_LABEL[agent]} agora. Motivo: AGENTES_ASK_TOKEN não está configurado no Orchestrator.`;
  }

  const url = process.env[agent === 'jarbas' ? 'JARBAS_ASK_URL' : 'SUZY_ASK_URL'] ?? DEFAULT_URL[agent];
  try {
    // Personalidade oficial injetada na pergunta (mesma regra do chat, ver
    // personalities.ts no context-engine): a menção no ClickUp fala com o
    // MESMO cérebro do chat, então o tom tem que ser o mesmo.
    return await askAgent({ url, token, agent, timeoutMs: AGENT_TIMEOUT_MS[agent] }, withPersonality(agent, question), `clickup-${params.taskId}`);
  } catch (error) {
    const err = error as AgentAskError;
    return [
      `Não consegui trazer a resposta d${AGENT_LABEL[agent] === 'Suzy' ? 'a' : 'o'} ${AGENT_LABEL[agent]} agora.`,
      `Motivo: ${err.message}.`,
      'Isso é falha técnica, não quer dizer que a informação não exista. Não vou chutar nada.',
    ].join('\n');
  }
}

/** Equivalente ao respondAsAgent, mas pelo protocolo genérico de Node Agent que o Otto fala. */
export async function respondAsOtto(params: { taskId: string; commentId: string }): Promise<string | null> {
  const question = await fetchClickUpCommentText(params.taskId, params.commentId);

  const node = await findHealthyNodeForAgent('otto');
  if (!node) {
    return 'Não consegui chamar o Otto agora. Motivo: nenhum node saudável encontrado (máquina fora do ar ou não registrada).';
  }

  const nodeSecret = process.env.NODE_SECRET;
  if (!nodeSecret) {
    return 'Não consegui chamar o Otto agora. Motivo: NODE_SECRET não está configurado na API.';
  }

  try {
    const response = await fetch(`${buildNodeUrl(node.privateHost)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nodeSecret}` },
      body: JSON.stringify({
        execution_id: `clickup-${params.taskId}-${params.commentId}`,
        // Personalidade oficial injetada na pergunta, mesma regra dos demais.
        message: withPersonality('otto', question),
        context_refs: [],
      }),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS.otto),
    });
    if (!response.ok) {
      throw new Error(`Node returned ${response.status}: ${await response.text()}`);
    }
    const result = executeResponseSchema.parse(await response.json());
    if (result.status !== 'completed' || !result.answer) {
      throw new Error(result.error ?? 'Node reported failure');
    }
    return result.answer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      'Não consegui trazer a resposta do Otto agora.',
      `Motivo: ${message}.`,
      'Isso é falha técnica, não quer dizer que a informação não exista. Não vou chutar nada.',
    ].join('\n');
  }
}
