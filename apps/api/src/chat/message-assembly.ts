import type { AgentName } from '@desigual-os/types';

/**
 * Regras de montagem da mensagem por agente, extraídas de chat/routes.ts para
 * serem testáveis de forma isolada (portão do Jarbas, Onda 0). A lógica é a
 * mesma que estava inline na rota; os comentários com a medição original
 * continuam em chat/routes.ts.
 *
 * As duas regras nasceram de incidentes medidos em produção (09/09 e
 * 10/09/2026):
 *
 * - O bento-qa usa a mensagem INTEIRA como consulta vetorial. Bloco de
 *   contexto geral (usuário, dossiê, histórico) na mensagem degradava a busca
 *   e gerava resposta errada COM citação. Por isso o Bento não recebe o bloco
 *   de contexto na mensagem; o dado operacional vai em campo separado.
 *
 * - O serviço de Jarbas/Suzy classifica a mensagem inteira, e um bloco
 *   operacional grande (nomes de cliente, "campanha", "relatório") dispara o
 *   edge case job_via_whatsapp, que responde com erro genérico e ignora a
 *   pergunta. Por isso o bloco operacional NUNCA vai na mensagem deles.
 */

/** O bloco de contexto geral envenena a busca vetorial do bento-qa. */
export function contextoEnvenenaBusca(agent: AgentName): boolean {
  return agent === 'bento';
}

/**
 * Quem pode receber o bloco operacional do ClickUp ANEXADO na mensagem.
 * Bento recebe por campo separado (operational_context); Jarbas e Suzy nunca
 * recebem; só Otto e Studio aceitam na mensagem.
 */
export function agenteAceitaBlocoNaMensagem(agent: AgentName): boolean {
  return agent === 'otto' || agent === 'studio';
}
