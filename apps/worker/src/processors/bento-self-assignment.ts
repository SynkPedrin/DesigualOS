/**
 * bento-self-assignment.ts — "me coloca como responsável" é a própria pessoa.
 *
 * Achado ao vivo em 28/09/2026, com a Tammy: *"Agora me coloque também como
 * responsável nessa tarefa"* virou `assignee: "D. Carvalho"` — o NOME DO
 * CLIENTE. O planner recebe o cliente no contexto e não recebia quem estava
 * falando, então, diante de um "me" sem nome, preencheu com o único nome
 * próprio que tinha à mão. A resposta foi "não encontrei 'D. Carvalho' entre os
 * membros do ClickUp", que esconde o erro real: não era nome errado, era a
 * ENTIDADE errada — cliente no lugar de pessoa.
 *
 * Duas regras, as duas determinísticas de propósito. Quem é o responsável de
 * uma task muda o trabalho de alguém; isso não pode depender de o modelo
 * acertar o pronome.
 *
 *   1. Primeira pessoa ("me coloca", "pra mim", "me atribui") = quem pediu.
 *   2. Cliente NUNCA é pessoa. Assignee igual ao nome do cliente é sintoma,
 *      não dado — vira "não sei quem", que faz o Bento perguntar, em vez de
 *      atribuir a task para alguém errado ou inexistente.
 */

/** Só vale como auto-atribuição quando o "me"/"mim" está ligado a um verbo de atribuir. */
const VERBOS_DE_ATRIBUIR =
  'coloca|coloque|poe|poem|põe|ponha|bota|bote|atribui|atribua|adiciona|adicione|inclui|inclua|insere|insira|marca|marque|passa|passe|delega|delegue|assume|assumo';

const PRIMEIRA_PESSOA: RegExp[] = [
  // "me coloca", "me atribui", "me põe" — pronome antes do verbo.
  new RegExp(`(^|[\\s,;:.!])(me|mim)\\s+(${VERBOS_DE_ATRIBUIR})\\b`, 'i'),
  // "coloca eu", "atribui pra mim", "passa para mim", "assume pra mim".
  new RegExp(`(${VERBOS_DE_ATRIBUIR})\\b[^.!?]{0,40}?\\b(pra|para)\\s+mim\\b`, 'i'),
  // "me ... como responsável" — com qualquer coisa curta no meio.
  /(^|[\s,;:.!])(me|mim)\b[^.!?]{0,40}?\bcomo\s+respons[áa]vel\b/i,
  // "eu como responsável", "sou eu o responsável", "fico eu".
  /\b(eu|fico\s+eu|sou\s+eu)\b[^.!?]{0,30}?\brespons[áa]vel\b/i,
];

export function pedeAutoAtribuicao(message: string): boolean {
  return PRIMEIRA_PESSOA.some((re) => re.test(message));
}

function mesmoNome(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const limpa = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
  return limpa(a) === limpa(b) && limpa(a).length > 0;
}

export interface CorrecaoDeResponsavel {
  /** O nome que deve ir pro ClickUp, ou null quando não dá pra saber. */
  assignee: string | null;
  /** Por que mudou — entra no log, nunca na resposta ao usuário. */
  motivo: 'auto_atribuicao' | 'cliente_nao_e_pessoa' | null;
}

/**
 * Corrige o responsável proposto pelo planner ANTES de qualquer escrita.
 *
 * `requesterName` é quem está falando (execute-job já tem: nome do usuário do
 * job). `clientName` é o cliente do turno. Nenhum dos dois é inventado aqui —
 * não havendo como saber, devolve null e o caminho de cima pergunta.
 */
export function corrigirResponsavel(params: {
  message: string;
  assignee: string | null | undefined;
  requesterName: string | null | undefined;
  clientName: string | null | undefined;
}): CorrecaoDeResponsavel {
  const proposto = params.assignee?.trim() || null;
  const autoAtribuicao = pedeAutoAtribuicao(params.message);

  if (autoAtribuicao && params.requesterName?.trim()) {
    // Vale mesmo quando o planner propôs OUTRO nome: "me coloca também" com o
    // cliente no contexto é exatamente o caso que produziu o bug.
    if (!proposto || mesmoNome(proposto, params.clientName) || !mesmoNome(proposto, params.requesterName)) {
      return { assignee: params.requesterName.trim(), motivo: 'auto_atribuicao' };
    }
  }

  if (proposto && mesmoNome(proposto, params.clientName)) {
    // Cliente não é pessoa. Sem saber quem é, o certo é não atribuir.
    return { assignee: null, motivo: 'cliente_nao_e_pessoa' };
  }

  return { assignee: proposto, motivo: null };
}
