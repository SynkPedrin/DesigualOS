/**
 * count-consistency.ts — checagem determinística de CONTAGEM contra a
 * evidência operacional.
 *
 * Por que existe: no release gate (15/09/2026), a mesma pergunta — "quantas
 * tarefas vencem hoje?" — recebeu quatro respostas diferentes do serviço do
 * Bento no mesmo dia, com o MESMO bloco operacional (15 tarefas) na entrada:
 * "5 tarefas", "15 de 50 clientes consultados", "Nenhuma tarefa vence hoje" e
 * "Hoje vão vencer 3 tarefas". O bloco estava certo; a leitura dele é que não
 * era confiável.
 *
 * A ancoragem por token (groundClaims) não pega isso: "nenhuma" não tem
 * número, e "5" chega a casar com o "5 cliente(s)" do próprio bloco. Contagem
 * é justamente o tipo de afirmação que dá pra conferir SEM modelo nenhum —
 * então se confere aqui, com regex, contra o número que o próprio
 * build-operational-context escreveu.
 *
 * Escopo estreito de propósito: só opina quando o bloco declara um total E a
 * resposta conta tarefas. Resposta que não cita contagem nenhuma passa.
 */

export interface CountCheck {
  /** null = nada a checar (bloco sem total declarado, ou resposta sem contagem). */
  ok: boolean | null;
  expected: number | null;
  claimed: number | null;
  reason: string | null;
}

/** Total declarado pelo bloco operacional: "15 tarefa(s) aberta(s) ...". */
export function expectedCount(operationalContext: string): number | null {
  // Lista crua: "15 tarefa(s) aberta(s)".
  const lista = /(\d+)\s+tarefa\(s\)\s+aberta\(s\)/i.exec(operationalContext);
  if (lista?.[1]) return Number(lista[1]);
  // Briefing: "VISÃO GERAL" seguida de "15 tarefa(s) | 3 atrasada(s) | ...".
  const briefing = /(\d+)\s+tarefa\(s\)\s*\|/i.exec(operationalContext);
  return briefing?.[1] ? Number(briefing[1]) : null;
}

// "Nenhuma tarefa", "não há tarefas", "zero tarefas".
// Sem \b depois de "há": \b é ASCII-only em JS e "á" não é word char, então
// \bh[áa]\b nunca casava e "não há tarefas" passava batido.
const NEGACAO = /\b(nenhum[ao]?|zero)\b[^.!?\n]{0,40}(tarefas?|tasks?)\b|n[ãa]o\s+h[áa][^.!?\n]{0,40}(tarefas?|tasks?)\b/i;

// Qualquer "N tarefa(s)" na resposta. Só o início de frase era estreito demais:
// "Hoje vão vencer 3 tarefas" passava batido (medido ao vivo).
const CONTAGENS = /(\d+)\s+(?:tarefas?|tasks?)\b/gi;

/**
 * Confere a resposta contra o total do bloco. Devolve ok=false só quando há
 * contradição inequívoca.
 */
export function checkCountConsistency(answer: string, operationalContext: string): CountCheck {
  const expected = expectedCount(operationalContext);
  if (expected === null) return { ok: null, expected: null, claimed: null, reason: null };

  if (expected > 0 && NEGACAO.test(answer)) {
    return {
      ok: false,
      expected,
      claimed: 0,
      reason: `a resposta afirma que não há tarefas, mas o dado ao vivo traz ${expected}`,
    };
  }

  // Todas as contagens de tarefa citadas. Se a resposta conta tarefas mas
  // NUNCA cita o total do bloco, ou está contando outra coisa, ou errou — nos
  // dois casos a afirmação não se sustenta no dado recuperado.
  const citadas = [...answer.matchAll(CONTAGENS)].map((m) => Number(m[1]));
  if (citadas.length === 0) return { ok: null, expected, claimed: null, reason: null };
  if (citadas.includes(expected)) return { ok: true, expected, claimed: expected, reason: null };
  return {
    ok: false,
    expected,
    claimed: citadas[0] ?? null,
    reason: `a resposta cita ${citadas.join('/')} tarefa(s) e em nenhum momento o total real, que é ${expected}`,
  };
}
