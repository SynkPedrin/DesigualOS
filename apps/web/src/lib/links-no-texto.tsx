import { Fragment, type ReactNode } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LINKS CLICÁVEIS NO TEXTO DE UMA MENSAGEM (Inbox e Comunicação).
 *
 * Reconhece o que as pessoas de fato colam numa conversa: `https://…`,
 * `www.…`, domínio solto (`agenciadesigual.com.br`, `instagram.com/perfil`) e
 * e-mail, e também o markdown que o ClickUp devolve (`[nome](url)`, `<url>`,
 * `Agencia\_Desigual` com a barra de escape). O texto é sempre texto. Só vira link o que passa por `new URL` com
 * protocolo http, https ou mailto, então `javascript:` nunca vira link.
 * Abre em aba nova, sem `opener` nem `referrer`.
 */

export type PedacoDeTexto = { tipo: 'texto'; texto: string } | { tipo: 'link'; texto: string; href: string; rotulado?: boolean };

// Terminações comuns de domínio. Lista fechada de propósito: "arquivo.pdf",
// "v1.2" e "R$ 1.500,00" não podem virar link.
const TERMINACOES = 'com|net|org|br|io|ai|app|dev|co|me|tv|info|biz|store|shop|online|site|link|ly|gl|gg|us|uk|pt|es|edu|gov|xyz|tech|digital|agency|studio|art|blog|news|email|cloud|page|so|to|fm|club|vip|pro|ar|cl|mx';

const PADRAO = new RegExp(
  [
    // markdown do ClickUp: [nome](url) e <url>. A url aceita um nível de parêntese ("Arte (1).png").
    String.raw`\[[^\]\n]+\]\((?:https?:\/\/|mailto:)(?:[^\s()]|\([^\s()]*\))+\)`,
    String.raw`<https?:\/\/[^\s<>]+>`,
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
    if ('.,;:!?\'"*~'.includes(ultimo)) { sobra = ultimo + sobra; link = link.slice(0, -1); continue; }
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

/** O ClickUp escapa pontuação do markdown dentro da url ("Agencia\\_Desigual"); a barra não é do endereço. */
const semEscape = (s: string) => s.replace(/\\([_\-.*()~#!+[\]])/g, '$1');

/** Endereço que pode virar link (http, https, mailto) já normalizado, ou null. */
export function hrefDe(link: string): string | null {
  const bruto = /^mailto:/i.test(link) ? link : /^[^\s:/?#]+@/.test(link) && !link.includes('/') ? `mailto:${link}` : /^https?:\/\//i.test(link) ? link : `https://${link}`;
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
    juntarTexto(texto.slice(desde, inicio));
    desde = inicio + achado[0].length;
    const md = /^\[([^\]\n]+)\]\((.+)\)$/.exec(achado[0]) ?? /^<()(.+)>$/.exec(achado[0]);
    if (md) {
      const alvo = semEscape(md[2]!);
      const href = hrefDe(alvo);
      const rotulo = semEscape(md[1]!);
      if (href) pedacos.push({ tipo: 'link', texto: rotulo && rotulo !== alvo ? rotulo : alvo, href, rotulado: Boolean(rotulo && rotulo !== alvo) });
      else juntarTexto(achado[0]);
      continue;
    }
    const { link: bruto, sobra } = aparar(achado[0]);
    const link = semEscape(bruto);
    const href = link ? hrefDe(link) : null;
    if (href) pedacos.push({ tipo: 'link', texto: link, href });
    else juntarTexto(bruto);
    juntarTexto(sobra);
  }
  juntarTexto(texto.slice(desde));
  return pedacos;
}

/**
 * Serviço de arquivo conhecido pelo endereço: o link longo do SharePoint vira "SharePoint · Pasta",
 * que é o que a pessoa reconhece. O endereço completo continua no title e no href.
 */
const TIPO_SHAREPOINT: Record<string, string> = { f: 'Pasta', x: 'Planilha', w: 'Documento', p: 'Apresentação', b: 'PDF', i: 'Imagem', v: 'Vídeo', u: 'Arquivo', o: 'Notas' };

export function servicoDoLink(href: string): { servico: string; tipo?: string | undefined } | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const caminho = url.pathname;
  if (host.endsWith('.sharepoint.com')) {
    const pessoal = host.includes('-my.') || caminho.includes('/personal/');
    const letra = /^\/:([a-z]):\//i.exec(caminho)?.[1]?.toLowerCase();
    const tipo = letra ? TIPO_SHAREPOINT[letra] : /\/Forms\/AllItems\.aspx$/i.test(caminho) ? 'Pasta' : undefined;
    return { servico: pessoal ? 'OneDrive' : 'SharePoint', tipo };
  }
  if (host === 'onedrive.live.com' || host === '1drv.ms') return { servico: 'OneDrive' };
  if (host === 'drive.google.com') return { servico: 'Google Drive', tipo: caminho.includes('/folders/') ? 'Pasta' : 'Arquivo' };
  if (host === 'docs.google.com') {
    const tipo = caminho.startsWith('/spreadsheets') ? 'Planilha' : caminho.startsWith('/presentation') ? 'Apresentação' : caminho.startsWith('/forms') ? 'Formulário' : 'Documento';
    return { servico: 'Google', tipo };
  }
  if (host.endsWith('figma.com')) return { servico: 'Figma' };
  if (host.endsWith('canva.com')) return { servico: 'Canva' };
  if (host === 'app.clickup.com' || host.endsWith('.clickup.com')) return { servico: 'ClickUp' };
  return null;
}

/** Azul e sublinhado em todo lugar: é o que as pessoas reconhecem como "dá para clicar". */
export const CLASSE_DO_LINK = 'break-words text-link underline decoration-link/40 underline-offset-2 hover:decoration-link';
const CHIP = 'mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-link/30 bg-link/10 px-1.5 py-px align-baseline text-[0.92em] font-medium text-link no-underline hover:bg-link/20';

/** Um link do texto. Serviço conhecido vira selo ("SharePoint · Pasta"); o resto mostra o próprio endereço. */
export function LinkNoTexto({ href, texto, rotulado, className }: { href: string; texto: string; rotulado?: boolean | undefined; className?: string | undefined }) {
  const servico = href.startsWith('mailto:') ? null : servicoDoLink(href);
  const externo = !href.startsWith('/');
  return (
    <a
      href={href}
      {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      title={href.startsWith('mailto:') ? undefined : href}
      // A bolha tem ações próprias (responder, reagir…); o clique no link é só o link.
      onClick={(e) => e.stopPropagation()}
      className={cn(CLASSE_DO_LINK, className, servico && CHIP)}
    >
      {servico ? (
        <>
          <LinkIcon aria-hidden size={12} className="shrink-0" />
          <span className="truncate">{rotulado ? texto : `${servico.servico}${servico.tipo ? ` · ${servico.tipo}` : ''}`}</span>
        </>
      ) : texto.length > 80 ? `${texto.slice(0, 77)}…` : texto}
    </a>
  );
}

/** Nós prontos para pôr dentro de um <p>: texto puro e <a> para cada link. */
export function textoComLinks(texto: string, classeDoLink: string, chave = ''): ReactNode[] {
  return quebrarEmLinks(texto).map((p, i) =>
    p.tipo === 'link' ? (
      <LinkNoTexto key={`${chave}${i}`} href={p.href} texto={p.texto} rotulado={p.rotulado} className={classeDoLink} />
    ) : (
      <Fragment key={`${chave}${i}`}>{p.texto}</Fragment>
    ),
  );
}
