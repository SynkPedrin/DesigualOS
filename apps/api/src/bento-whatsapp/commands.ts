/**
 * Atalhos. Nenhum é obrigatório: "Bento, o que tenho pra hoje?" chega ao mesmo
 * lugar que /tarefas. Os atalhos que pedem dado viram PERGUNTA em linguagem
 * natural para o Brain — não existe consulta paralela aqui. Só /ajuda e /novo
 * são resolvidos no próprio canal, porque são sobre o canal.
 */

export type Atalho =
  | { tipo: 'ajuda' }
  | { tipo: 'nova_conversa' }
  | { tipo: 'pergunta'; texto: string };

const PERGUNTAS: Record<string, string> = {
  status: 'Como está a operação hoje? Me dá um panorama curto, com o que precisa de atenção.',
  tarefas: 'Quais são as minhas tarefas abertas? Começa pelas atrasadas e pelas que vencem hoje, com prazo.',
  resumo: 'Resume as minhas prioridades de hoje.',
};

export function interpretarAtalho(texto: string): Atalho | null {
  const achado = texto.trim().match(/^\/([a-zçãé]+)\b\s*(.*)$/i);
  if (!achado) return null;
  const comando = achado[1]!.toLowerCase();
  const resto = achado[2]?.trim() ?? '';
  if (comando === 'ajuda' || comando === 'help') return { tipo: 'ajuda' };
  if (comando === 'novo' || comando === 'nova') return { tipo: 'nova_conversa' };
  const base = PERGUNTAS[comando];
  if (!base) return null;
  return { tipo: 'pergunta', texto: resto ? `${base} ${resto}` : base };
}
