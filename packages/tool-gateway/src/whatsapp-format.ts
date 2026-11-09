/**
 * Apresentação no WhatsApp — e SÓ apresentação.
 *
 * O texto que chega aqui é a resposta do Brain, a mesma gravada em `messages`
 * e mostrada na web. Esta camada troca sintaxe (Markdown → marcação do
 * WhatsApp) e corta em partes; ela não resume, não reescreve, não remove
 * frase. Se uma regra daqui algum dia precisar mudar conteúdo, ela está no
 * lugar errado.
 *
 * WhatsApp entende: *negrito*, _itálico_, ~tachado~, ```bloco```, `código`,
 * "> citação", listas com "- " ou "1. ". Não entende: títulos, links
 * [texto](url), tabelas, **duplo asterisco**.
 */

const LIMITE_POR_MENSAGEM = 3_500;
const MAXIMO_DE_PARTES = 5;

function converterLinha(linha: string): string {
  let saida = linha;
  // Título "# X" → *X* (o WhatsApp não tem título; negrito é o equivalente visual).
  const titulo = saida.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (titulo) return `*${titulo[1]!.replace(/\*\*/g, '').replace(/\*/g, '')}*`;
  // Separador horizontal some (vira linha vazia no agrupamento).
  if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(saida)) return '';
  // Link [texto](url) → texto (url). URL igual ao texto vira só a URL.
  saida = saida.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, texto: string, url: string) =>
    texto.trim() === url ? url : `${texto} (${url})`,
  );
  // **negrito** / __negrito__ → *negrito*
  saida = saida.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '*$1*');
  saida = saida.replace(/__(?=\S)(.+?)(?<=\S)__/g, '*$1*');
  // ~~tachado~~ → ~tachado~
  saida = saida.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '~$1~');
  // Item de lista com "* " → "- " (no WhatsApp, "* " abre negrito sem fechar).
  saida = saida.replace(/^(\s*)\*\s+/, '$1- ');
  return saida;
}

/** Linha de tabela Markdown → "célula · célula". A linha separadora (|---|) some. */
function converterTabela(linhas: string[]): string[] {
  return linhas
    .filter((linha) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linha))
    .map((linha) =>
      linha
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((celula) => celula.trim())
        .filter(Boolean)
        .join(' · '),
    );
}

export function markdownParaWhatsapp(texto: string): string {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const saida: string[] = [];
  let emBloco = false;
  let tabela: string[] = [];
  const despejarTabela = () => {
    if (tabela.length) saida.push(...converterTabela(tabela).map(converterLinha));
    tabela = [];
  };
  for (const linha of linhas) {
    if (/^\s*```/.test(linha)) {
      despejarTabela();
      emBloco = !emBloco;
      saida.push('```');
      continue;
    }
    if (emBloco) {
      saida.push(linha);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(linha)) {
      tabela.push(linha);
      continue;
    }
    despejarTabela();
    saida.push(converterLinha(linha));
  }
  despejarTabela();
  if (emBloco) saida.push('```');
  return saida
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Corta em partes que cabem numa mensagem, sempre em fronteira de parágrafo,
 * depois de linha, e só em último caso no meio de uma linha enorme. Nunca
 * descarta texto: se passar do máximo de partes, a última leva o resto e
 * vai maior que o limite (o OpenWA aceita até 4096; acima disso, o envio da
 * parte falha e o erro aparece — não some calado).
 */
export function dividirEmPartes(texto: string, limite = LIMITE_POR_MENSAGEM): string[] {
  if (texto.length <= limite) return texto ? [texto] : [];
  const partes: string[] = [];
  let restante = texto;
  while (restante.length > limite && partes.length < MAXIMO_DE_PARTES - 1) {
    const janela = restante.slice(0, limite);
    let corte = janela.lastIndexOf('\n\n');
    if (corte < limite * 0.4) corte = janela.lastIndexOf('\n');
    if (corte < limite * 0.4) corte = janela.lastIndexOf(' ');
    if (corte <= 0) corte = limite;
    partes.push(restante.slice(0, corte).trimEnd());
    restante = restante.slice(corte).trimStart();
  }
  if (restante) partes.push(restante);
  return partes;
}

export function formatarParaWhatsapp(texto: string): string[] {
  return dividirEmPartes(markdownParaWhatsapp(texto));
}
