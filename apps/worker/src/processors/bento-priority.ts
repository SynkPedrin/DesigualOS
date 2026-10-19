/**
 * bento-priority.ts — prioridade não é status.
 *
 * 28/09/2026, ao vivo com a Tammy: *"altere o status dessa task para urgente"*
 * levou de volta a lista de status válidos da lista ("aberto, aguardando
 * aprovação, alteração, reprovado, pronto, encerrado"). A recusa estava certa —
 * "urgente" não é status — e parava no lugar errado: **prioridade é um campo do
 * ClickUp que o executor já sabia escrever**, só não existia no plano. O
 * resultado prático foi um não para um pedido perfeitamente executável.
 *
 * Duas peças aqui:
 *   1. a tradução palavra → escala 1-4 do ClickUp;
 *   2. o desvio determinístico de um "status" que na verdade é prioridade —
 *      porque a pessoa vai continuar dizendo "status" (ela disse), e o certo é
 *      entender, não corrigir o vocabulário de quem trabalha.
 */

/** Escala do ClickUp: 1 urgent · 2 high · 3 normal · 4 low. */
export type ClickUpPriority = 1 | 2 | 3 | 4;

const PALAVRAS: Array<{ re: RegExp; valor: ClickUpPriority }> = [
  { re: /\b(urgent(e|issimo)?|urgência|urgencia|máxima|maxima|crític[ao]|critic[ao]|prioridade\s+m[áa]xima)\b/i, valor: 1 },
  { re: /\b(alta|alto|high|elevada|importante)\b/i, valor: 2 },
  { re: /\b(normal|m[ée]dia|media|padr[ãa]o|comum)\b/i, valor: 3 },
  { re: /\b(baixa|baixo|low|menor)\b/i, valor: 4 },
];

export function mapPrioridade(texto: string | null | undefined): ClickUpPriority | null {
  if (!texto?.trim()) return null;
  for (const { re, valor } of PALAVRAS) {
    if (re.test(texto)) return valor;
  }
  return null;
}

/**
 * O planner às vezes manda a prioridade no campo `status` — é o caso literal da
 * Tammy, e é o que acontece sempre que a pessoa usa a palavra "status" pra
 * falar de urgência. Aqui o campo é desviado ANTES da escrita.
 *
 * Só desvia quando o texto do status É prioridade e NÃO é um status de fluxo.
 * "pronto", "aprovado", "em revisão" nunca passam por aqui.
 */
export function desviarStatusQueEhPrioridade(changes: {
  status?: string | undefined;
  priority?: string | undefined;
}): { status?: string | undefined; priority?: string | undefined; desviado: boolean } {
  if (changes.priority?.trim() || !changes.status?.trim()) {
    return { ...changes, desviado: false };
  }
  // A palavra sozinha (ou quase) é prioridade — "urgente", "alta prioridade".
  // Um status de fluxo que por acaso contenha "alta" não existe; ainda assim a
  // comparação é sobre o texto INTEIRO do status pedido, não sobre conter.
  const limpo = changes.status
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(prioridade|prioridades|como|para|pra)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo || limpo.split(' ').length > 2) return { ...changes, desviado: false };
  const valor = mapPrioridade(limpo);
  if (valor === null) return { ...changes, desviado: false };
  const { status: _descartado, ...resto } = changes;
  return { ...resto, priority: changes.status, desviado: true };
}
