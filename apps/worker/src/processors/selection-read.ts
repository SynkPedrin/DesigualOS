import { detectSelectionReference, resolveSelectionReference } from '@desigual-os/context-engine';
import { getTaskComments, type ClickUpConfig } from '@desigual-os/tool-gateway';
import { getClickUpConfigOrNull, loadSelectionSnapshot } from './bento-action-guard';

/**
 * selection-read.ts — LEITURA endereçada sobre o item em foco da seleção.
 *
 * "qual o briefing dela?" depois de "e a segunda?" não é consulta ao ClickUp
 * inteiro nem pergunta pro RAG: é o comentário de briefing que o próprio Bento
 * gravou naquela task. Responder do banco/ClickUp endereçado é o que impede o
 * modelo de improvisar um briefing que não existe.
 */

const PERGUNTA_BRIEFING_FOCO = /\b(briefing|brief)\b/i;

/**
 * Responde "qual o briefing dela?" lendo os comentários REAIS da task em foco.
 * null quando a pergunta não é sobre o briefing do foco — o turno segue normal.
 */
export async function responderBriefingDoItemEmFoco(
  conversationId: string | null,
  message: string,
): Promise<string | null> {
  const t = message.split(/\n-{3,}\n/)[0] ?? message;
  if (!PERGUNTA_BRIEFING_FOCO.test(t) || t.length > 160) return null;
  // Só perguntas (ou pedidos de mostra), nunca ordens: "crie briefing" é escrita.
  if (/\b(cri[ae]|mont[ae]|faz|faça|atualiz|gera|gere|reescrev)/i.test(t)) return null;
  if (!conversationId) return null;

  const selecao = await loadSelectionSnapshot(conversationId).catch(() => null);
  if (!selecao?.focusTaskId) return null;
  const ref = detectSelectionReference(t);
  if (!ref || (ref.kind !== 'focus' && ref.kind !== 'ordinal')) return null;
  const resolvida = resolveSelectionReference(selecao, ref);
  const task = resolvida?.tasks.length === 1 ? resolvida.tasks[0] : null;
  if (!task) return null;

  const config: ClickUpConfig | null = getClickUpConfigOrNull();
  if (!config) return null;
  const comentarios = await getTaskComments(config, task.id).catch(() => null);
  if (!comentarios) return null;
  const briefing = [...comentarios].reverse().find((c) => c.text.startsWith('BRIEFING'));
  const link = task.url ?? `https://app.clickup.com/t/${task.id}`;
  if (!briefing) {
    return `A task "${task.title}" ainda não tem briefing gravado em comentário no ClickUp. Se quiser, eu monto um agora: ${link}`;
  }
  const texto = briefing.text.length > 1800 ? `${briefing.text.slice(0, 1800)}\n\n[...] o briefing completo está na task: ${link}` : briefing.text;
  return `O briefing de "${task.title}" (gravado em comentário na task, ${link}):\n\n${texto}`;
}
