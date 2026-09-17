import type { FonteDeContexto } from './context-assembler';

/**
 * provenance-block.ts — quando perguntam "de onde você tirou isso?".
 *
 * Medido no navegador em 16/09/2026: perguntado "quem trabalha na conta da
 * Cosentino e de onde você tirou essa informação?", o Bento nomeou a equipe
 * certa e simplesmente não disse a origem. A resposta estava correta e mesmo
 * assim era inútil para quem precisa decidir se confia nela.
 *
 * A correção não é pedir ao modelo, num prompt, que "sempre cite a fonte" —
 * ele não tem como saber de onde o texto veio, porque o contexto chega como
 * texto. A correção é ENTREGAR a lista de fontes realmente consultadas neste
 * turno, para que citar seja questão de ler, não de lembrar.
 */

/** O turno está pedindo proveniência? */
const PEDE_FONTE =
  /\b(de onde|da onde|qual (é |e )?a fonte|quais (as )?fontes|como (você |voce )?sabe|onde (você |voce )?(viu|leu|achou)|em que (você |voce )?se baseou|baseado em qu[êe])\b/i;

export function pedeProveniencia(mensagem: string): boolean {
  return PEDE_FONTE.test(mensagem);
}

/** Como cada fonte do pacote se chama para um humano. */
const NOME_HUMANO: Record<FonteDeContexto, string> = {
  frescor: 'estado de sincronização com o ClickUp',
  cliente: 'dossiê do cliente registrado no sistema',
  campanha: 'registro de campanhas, derivado das tarefas do ClickUp',
  pessoas: 'registro de pessoas e relações, derivado do ClickUp',
  episodios: 'memória do que foi decidido em conversas anteriores, com data',
  preferencias: 'preferências consolidadas do cliente',
  // Atribuição honesta importa aqui mais que em qualquer outra fonte: dizer
  // "ClickUp" para algo que alguém falou no chat inventa uma autoridade que o
  // fato não tem, e quem lê não consegue mais checar de onde veio.
  aprendizado: 'informado por alguém da equipe na conversa, com data',
  outra: 'registro adicional',
} as Record<FonteDeContexto, string>;

/**
 * Bloco com as fontes REAIS deste turno. Vazio quando ninguém perguntou — não
 * é para todo turno virar bibliografia.
 */
export function formatProvenanceBlock(mensagem: string, fontes: FonteDeContexto[]): string {
  if (!pedeProveniencia(mensagem)) return '';
  if (fontes.length === 0) {
    return [
      'PROVENIÊNCIA: você NÃO recebeu nenhuma fonte estruturada neste turno.',
      'Diga isso com todas as letras em vez de citar uma fonte genérica.',
    ].join('\n');
  }
  const linhas = ['PERGUNTARAM DE ONDE VEIO A INFORMAÇÃO. As fontes deste turno, e só elas, são:'];
  for (const f of fontes) linhas.push(`- ${NOME_HUMANO[f] ?? f}`);
  linhas.push(
    '',
    'Cite-as ao responder, em linguagem de gente. NÃO invente fonte que não está aqui,',
    'e NÃO diga "meu conhecimento interno": isso não é resposta para quem precisa conferir.',
  );
  return linhas.join('\n');
}

/**
 * Seção de fontes ANEXADA à resposta, montada a partir das evidências que de
 * fato entraram no turno.
 *
 * Por que determinística: o bloco de instrução resolve parte do problema, mas
 * medido no navegador (16/09/2026) o Bento recebeu as fontes e ainda assim
 * respondeu sem citá-las — a síntese do node prioriza o dado operacional e a
 * instrução se perde. Depender do modelo "lembrar de mencionar" a fonte é
 * depender exatamente do que falhou. Aqui a seção é escrita pelo sistema, com
 * os nomes reais, e não há como inventar rótulo de fonte.
 *
 * Só aparece quando alguém PERGUNTA. Fonte em toda resposta transformaria o
 * chat numa auditoria e treinaria a equipe a ignorar o rodapé.
 */
export function anexarFontes(resposta: string, mensagem: string, fontes: FonteDeContexto[]): string {
  if (!pedeProveniencia(mensagem)) return resposta;
  if (resposta.trim().length === 0) return resposta;

  // Já citou de forma reconhecível? Não duplica a seção.
  if (/^\s*fontes? (utilizadas|consultadas)/im.test(resposta)) return resposta;

  if (fontes.length === 0) {
    return `${resposta.trimEnd()}\n\nFontes utilizadas: nenhuma fonte estruturada entrou neste turno.`;
  }
  const linhas = [...new Set(fontes.map((f) => NOME_HUMANO[f] ?? f))].map((n) => `- ${n}`);
  return `${resposta.trimEnd()}\n\nFontes utilizadas:\n${linhas.join('\n')}`;
}
