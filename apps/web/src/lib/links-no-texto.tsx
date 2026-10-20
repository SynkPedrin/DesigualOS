import { Fragment, type ReactNode } from 'react';

/**
 * LINKS CLICÁVEIS NO TEXTO DE UMA MENSAGEM (Inbox e Comunicação).
 *
 * Reconhece o que as pessoas de fato colam numa conversa: `https://…`,
 * `www.…`, domínio solto (`agenciadesigual.com.br`, `instagram.com/perfil`) e
 * e-mail. O texto é sempre texto. Só vira link o que passa por `new URL` com
 * protocolo http, https ou mailto, então `javascript:` nunca vira link.
 * Abre em aba nova, sem `opener` nem `referrer`.
 */

export type PedacoDeTexto = { tipo: 'texto'; texto: string } | { tipo: 'link'; texto: string; href: string };

// Terminações comuns de domínio. Lista fechada de propósito: "arquivo.pdf",
// "v1.2" e "R$ 1.500,00" não podem virar link.
const TERMINACOES = 'com|net|org|br|io|ai|app|dev|co|me|tv|info|biz|store|shop|online|site|link|ly|gl|gg|us|uk|pt|es|edu|gov|xyz|tech|digital|agency|studio|art|blog|news|email|cloud|page|so|to|fm|club|vip|pro|ar|cl|mx';

const PADRAO = new RegExp(
  [
    // e-mail antes de domínio, para "joao@site.com.br" não virar só "site.com.br"
    String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`,
    String.raw`https?:\/\/[^\s<>"']+`,
    String.raw`www\.[^\s<>"']+`,
    String.raw`(?<![@\w.\/-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:${TERMINACOES})(?:\.[a-z]{2})?(?![\w-])(?:[\/?#][^\s<>"']*)?`,
  ].join('|'),
  'gi',
);

/** Pontuação colada no fim ("veja site.com." / "(link)") não faz parte do link. */
function aparar(candidato: string): { link: string; sobra: string } {
  let link = candidato;
  let sobra = '';
  while (link.length > 0) {
    const ultimo = link[link.length - 1]!;
    if ('.,;:!?\'"'.includes(ultimo)) { sobra = ultimo + sobra; link = link.slice(0, -1); continue; }
    const pares: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    if (pares[ultimo]) {
      const abre = link.split(pares[ultimo]!).length - 1;
      const fecha = link.split(ultimo).length - 1;
      if (fecha > abre) { sobra = ultimo + sobra; link = link.slice(0, -1); continue; }
    }
    break;
  }
  return { link, sobra };
}

function hrefDe(link: string): string | null {
  const bruto = /^[^\s:/?#]+@/.test(link) && !link.includes('/') ? `mailto:${link}` : /^https?:\/\//i.test(link) ? link : `https://${link}`;
  try {
    const url = new URL(bruto);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function quebrarEmLinks(texto: string): PedacoDeTexto[] {
  const pedacos: PedacoDeTexto[] = [];
  let desde = 0;
  const juntarTexto = (t: string) => {
    if (!t) return;
    const anterior = pedacos[pedacos.length - 1];
    if (anterior?.tipo === 'texto') anterior.texto += t;
    else pedacos.push({ tipo: 'texto', texto: t });
  };
  for (const achado of texto.matchAll(PADRAO)) {
    const inicio = achado.index ?? 0;
    const { link, sobra } = aparar(achado[0]);
    const href = link ? hrefDe(link) : null;
    juntarTexto(texto.slice(desde, inicio));
    if (href) pedacos.push({ tipo: 'link', texto: link, href });
    else juntarTexto(link);
    juntarTexto(sobra);
    desde = inicio + achado[0].length;
  }
  juntarTexto(texto.slice(desde));
  return pedacos;
}

/** Nós prontos para pôr dentro de um <p>: texto puro e <a> para cada link. */
export function textoComLinks(texto: string, classeDoLink: string, chave = ''): ReactNode[] {
  return quebrarEmLinks(texto).map((p, i) =>
    p.tipo === 'link' ? (
      <a
        key={`${chave}${i}`}
        href={p.href}
        target="_blank"
        rel="noopener noreferrer"
        // A bolha tem ações próprias (responder, reagir…); o clique no link é só o link.
        onClick={(e) => e.stopPropagation()}
        className={classeDoLink}
      >
        {p.texto}
      </a>
    ) : (
      <Fragment key={`${chave}${i}`}>{p.texto}</Fragment>
    ),
  );
}
