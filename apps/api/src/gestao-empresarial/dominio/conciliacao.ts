export interface LinhaDeExtrato {
  id: string;
  postedOn: string;
  /** Com sinal: positivo entrou, negativo saiu. */
  amountCents: number;
}
export interface MovimentoDoRazao {
  id: string;
  occurredOn: string;
  amountCents: number;
}
export interface SugestaoDeConciliacao {
  linhaId: string;
  movimentoId: string | null;
  diasDeDiferenca: number | null;
  /** Mais de um movimento servia igualmente: a pessoa escolhe, o sistema não adivinha. */
  ambigua: boolean;
}

const dias = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));

/**
 * Sugere, para cada linha do extrato, o movimento do razão de MESMO valor (com sinal) e data
 * próxima. Sugestão não concilia: só a confirmação humana grava o vínculo. Cada movimento é
 * oferecido a no máximo uma linha, e empate vira `ambigua` em vez de escolha silenciosa.
 */
export function sugerirConciliacao(
  linhas: readonly LinhaDeExtrato[],
  movimentos: readonly MovimentoDoRazao[],
  opcoes: { toleranciaDias?: number } = {},
): SugestaoDeConciliacao[] {
  const tolerancia = opcoes.toleranciaDias ?? 3;
  const usados = new Set<string>();
  return [...linhas]
    .sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id))
    .map((linha) => {
      const candidatos = movimentos
        .filter((m) => !usados.has(m.id) && m.amountCents === linha.amountCents && dias(m.occurredOn, linha.postedOn) <= tolerancia)
        .map((m) => ({ m, d: dias(m.occurredOn, linha.postedOn) }))
        .sort((a, b) => a.d - b.d || a.m.id.localeCompare(b.m.id));
      const melhor = candidatos[0];
      if (!melhor) return { linhaId: linha.id, movimentoId: null, diasDeDiferenca: null, ambigua: false };
      const ambigua = candidatos.filter((c) => c.d === melhor.d).length > 1;
      if (!ambigua) usados.add(melhor.m.id);
      return { linhaId: linha.id, movimentoId: ambigua ? null : melhor.m.id, diasDeDiferenca: melhor.d, ambigua };
    });
}
