/**
 * PRIORIDADE DE TAREFA É TEXTO LIVRE DO CLICKUP, não um enum nosso.
 *
 * Cada workspace escreve o que quiser, e nas nossas próprias fixtures já
 * convivem "urgente", "alta" e "normal". Então classificar é HEURÍSTICA sobre
 * esse texto, declarada como tal, e o que não casa com nada devolve `null` em
 * vez de cair num balde padrão: chutar "Média" pra uma prioridade escrita de
 * outro jeito seria inventar uma leitura que ninguém fez.
 *
 * Mora num arquivo próprio, e não dentro do componente, por um motivo
 * prático que a desigualos-f9 mediu hoje na régua de cor da barra lateral:
 * importar o componente arrasta o cliente do Supabase e o teste morre antes
 * da primeira asserção, por falta de variável de ambiente. Regra que precisa
 * de teste não pode morar dentro de componente.
 */
export type NivelDePrioridade = 'alta' | 'media' | 'baixa';

export function classificarPrioridade(texto: string | null | undefined): NivelDePrioridade | null {
  const t = (texto ?? '').toLowerCase().trim();
  if (!t) return null;
  if (t.includes('urgent') || t.includes('alta') || t.includes('high')) return 'alta';
  if (t.includes('normal') || t.includes('média') || t.includes('media') || t.includes('medium')) return 'media';
  if (t.includes('baixa') || t.includes('low')) return 'baixa';
  return null;
}

/** Cor do chip por nível. `nenhuma` é o chip neutro de antes: sem
 *  classificação, sem cor inventada. */
export const CLASSE_DE_PRIORIDADE: Record<NivelDePrioridade | 'nenhuma', string> = {
  alta: 'bg-erro/15 text-erro',
  media: 'bg-aviso/15 text-aviso',
  baixa: 'bg-sucesso/15 text-sucesso',
  nenhuma: 'border border-grafite-elevado text-nevoa',
};
