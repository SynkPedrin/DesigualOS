/**
 * Normalização usada SÓ para filtrar os itens de navegação da paleta.
 *
 * Clientes, usuários e agentes chegam já filtrados pelo servidor (que ignora
 * acento e tolera erro de digitação via trigrama) e não passam por aqui: o
 * filtro embutido do cmdk foi desligado porque escondia resultado válido —
 * ele exige as letras do termo em ordem, e "consentino" não casa com
 * "Cosentino" por essa regra, mesmo o servidor tendo encontrado o cliente.
 */
export function normalizeForSearch(value: string): string {
  // Faixa explícita em vez de \p{Diacritic}: mesma coisa, sem depender da
  // versão de lib do TS pra propriedade unicode.
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Termo vazio mostra tudo; caso contrário casa por trecho, ignorando acento. */
export function matchesQuery(label: string, query: string): boolean {
  const normalizedQuery = normalizeForSearch(query);
  return normalizedQuery.length === 0 || normalizeForSearch(label).includes(normalizedQuery);
}
