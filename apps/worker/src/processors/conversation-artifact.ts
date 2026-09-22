export interface ArtifactTurn { role: string; content: string; agent?: string | null }

/** "Isso que você acabou de mostrar não está bom, refaz." */
export const CRITICA_DE_DRAFT = /ficou gen[eé]rico|n[aã]o gostei|troca|muda|ajust[ae]|outra dire[cç][aã]o/i;
/** "Isso que você acabou de mostrar ficou bom." */
export const APROVACAO_DE_DRAFT = /agora gostei|agora ficou bom|aprovad[oa]|essa ficou boa|perfeito|gostei dess[ae]/i;

/**
 * Feedback CURTO sobre um draft que acabou de ser mostrado — nunca uma
 * afirmação a registrar como conhecimento permanente do cliente. Achado real
 * (22/09/2026): "Ficou genérico." e "Agora gostei." não são perguntas e não
 * usam nenhum verbo de pedido ("crie", "faça"...), então passavam pelos dois
 * filtros de `detectKnowledgeStatement` e viravam "Registrado: - Ficou
 * genérico." — uma confirmação de preferência memorizada, NUNCA a revisão
 * real do roteiro. O Otto nunca chegava a produzir V2; a task final usava
 * esse "Registrado" como se fosse o conteúdo aprovado.
 */
export function looksLikeCreativeFeedback(message: string): boolean {
  return CRITICA_DE_DRAFT.test(message) || APROVACAO_DE_DRAFT.test(message);
}

/** Messages arrive chronologically. Approval binds to a concrete preceding draft. */
export function conversationArtifact(turns: ArtifactTurn[], agent: string): string | null {
  let latest: string | null = null;
  let approved: string | null = null;
  for (const turn of turns) {
    if (turn.role === 'assistant' && (!turn.agent || turn.agent === agent)) {
      if (turn.content.length >= 80 && !/app\.clickup\.com\/t\//.test(turn.content)) latest = turn.content;
    } else if (turn.role === 'user') {
      if (CRITICA_DE_DRAFT.test(turn.content)) approved = null;
      if (APROVACAO_DE_DRAFT.test(turn.content)) approved = latest;
    }
  }
  return approved ?? latest;
}

/** Creating creative material in chat is not an external task mutation. */
export function requestsExternalTask(message: string): boolean {
  return /\b(task|tarefa|clickup|demanda)\b|manda produzir|manda pra|cria isso (?:pro|pra|para)|coloca.*editar/i.test(message);
}
