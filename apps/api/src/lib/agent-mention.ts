/**
 * Resposta a menções @Jarbas/@Suzy no ClickUp, espelhando o fluxo do Bento
 * (bento-mention.ts): o webhook chama, a gente busca o texto real do
 * comentário, pergunta pro agente real via POST /internal/ask do
 * agentes-desigual (a mesma rota que o Chat central usa, ver
 * apps/worker/src/processors/execute-job.ts) e devolve o texto pronto pra
 * postar na thread. Falha é honesta: diz o motivo em vez de chutar.
 */
import { askAgent, AgentAskError } from '@desigual-os/tool-gateway';
import { AGENT_TIMEOUT_MS } from '@desigual-os/orchestrator';
import { fetchClickUpCommentText } from './bento-mention';

const AGENT_LABEL = { jarbas: 'Jarbas', suzy: 'Suzy' } as const;
const DEFAULT_URL = {
  jarbas: 'http://100.118.12.97:3102',
  suzy: 'http://100.86.237.73:3102',
} as const;

export type MentionedAgent = keyof typeof AGENT_LABEL;

/** Detecta a primeira menção a um agente no texto plano do comentário. */
export function detectMentionedAgent(text: string): MentionedAgent | 'bento' | null {
  const match = text.match(/@(bento|jarbas|suzy)\b/i);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() as MentionedAgent | 'bento';
}

export async function respondAsAgent(agent: MentionedAgent, params: { taskId: string; commentId: string }): Promise<string | null> {
  const question = await fetchClickUpCommentText(params.taskId, params.commentId);
  const token = process.env.AGENTES_ASK_TOKEN;
  if (!token) {
    return `Não consegui chamar ${AGENT_LABEL[agent]} agora. Motivo: AGENTES_ASK_TOKEN não está configurado no Orchestrator.`;
  }

  const url = process.env[agent === 'jarbas' ? 'JARBAS_ASK_URL' : 'SUZY_ASK_URL'] ?? DEFAULT_URL[agent];
  try {
    // sessionId por tarefa: a thread de comentários vira uma conversa só
    // pro agente, com histórico entre menções na mesma task.
    return await askAgent({ url, token, agent, timeoutMs: AGENT_TIMEOUT_MS[agent] }, question, `clickup-${params.taskId}`);
  } catch (error) {
    const err = error as AgentAskError;
    return [
      `Não consegui trazer a resposta d${AGENT_LABEL[agent] === 'Suzy' ? 'a' : 'o'} ${AGENT_LABEL[agent]} agora.`,
      `Motivo: ${err.message}.`,
      'Isso é falha técnica, não quer dizer que a informação não exista. Não vou chutar nada.',
    ].join('\n');
  }
}
