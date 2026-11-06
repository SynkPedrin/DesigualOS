'use client';

import { Fragment } from 'react';
import { CLASSE_DO_LINK, hrefDe, LinkNoTexto, quebrarEmLinks, textoComLinks } from '@/lib/links-no-texto';
import { cn } from '@/lib/utils';

/**
 * Texto de comentário/descrição com LINKS CLICÁVEIS. Entende: [texto](url), [DT-9](/daily-tasks?task=…),
 * endereços soltos (https://…, www.…, site.com.br, e-mail), **negrito**, _itálico_, ~~riscado~~, `código`, listas ("- ", "1. ", "- [x] "), separador "---" e menção @[Nome](id).
 * Só abre http(s), mailto e caminhos internos — nunca `javascript:`. Links externos abrem em outra aba.
 */
// A url de [texto](url) aceita um nível de parêntese ("Arte (1).png"); a solta é aparada depois (pontuação e ")" sem par).
const TOKEN = /(\[[^\]\n]+\]\((?:(?:https?:\/\/|mailto:)(?:[^\s()]|\([^\s()]*\))+|\/[^\s)]*)\))|(@\[[^\]]+\]\([0-9a-f-]{36}\))|(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(https?:\/\/[^\s<>]+)|(~~[^~\n]+~~)|((?<![\w*])(?:_[^_\n]+_|\*[^*\n]+\*)(?![\w*]))/gi;

const CLASSE_LINK = cn(CLASSE_DO_LINK, 'break-all');

function Link({ href, texto, rotulado }: { href: string; texto: string; rotulado: boolean }) {
  if (href.startsWith('/')) return <a href={href} className={CLASSE_LINK} onClick={(e) => e.stopPropagation()}>{texto}</a>;
  // Só http(s) e mailto viram link; o resto fica como texto.
  const seguro = hrefDe(href);
  if (!seguro) return <>{texto}</>;
  return <LinkNoTexto href={seguro} texto={texto} rotulado={rotulado} className={CLASSE_LINK} />;
}

function inline(texto: string, chave: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(TOKEN)) {
    if (m.index! > ultimo) out.push(<Fragment key={`${chave}t${i++}`}>{textoComLinks(texto.slice(ultimo, m.index), CLASSE_LINK, `${chave}t${i}-`)}</Fragment>);
    const [tudo, md, mencao, negrito, codigo, url, riscado, italico] = m;
    if (md) { const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(md)!; out.push(<Link key={`${chave}l${i++}`} href={mm[2]!} texto={mm[1]!} rotulado={mm[1] !== mm[2]} />); }
    else if (mencao) { const mm = /^@\[([^\]]+)\]/.exec(mencao)!; out.push(<span key={`${chave}m${i++}`} className="rounded bg-roxo-eletrico/15 px-1 text-lilas">@{mm[1]}</span>); }
    else if (negrito) out.push(<strong key={`${chave}b${i++}`} className="font-semibold">{inline(negrito.slice(2, -2), `${chave}b${i}`)}</strong>);
    else if (codigo) out.push(<code key={`${chave}c${i++}`} className="rounded bg-carbono px-1 font-mono text-[0.85em]">{codigo.slice(1, -1)}</code>);
    else if (riscado) out.push(<s key={`${chave}r${i++}`}>{inline(riscado.slice(2, -2), `${chave}r${i}`)}</s>);
    else if (italico) out.push(<em key={`${chave}i${i++}`}>{inline(italico.slice(1, -1), `${chave}i${i}`)}</em>);
    else if (url) {
      // A sobra (pontuação ou ")" sem par no fim) volta para o texto, e a varredura segue dali.
      const [pedaco] = quebrarEmLinks(url);
      if (pedaco?.tipo === 'link') {
        out.push(<Link key={`${chave}u${i++}`} href={pedaco.href} texto={pedaco.texto} rotulado={false} />);
        if (pedaco.texto.length < url.length) out.push(<Fragment key={`${chave}s${i++}`}>{url.slice(pedaco.texto.length)}</Fragment>);
      } else out.push(<Fragment key={`${chave}s${i++}`}>{url}</Fragment>);
    }
    ultimo = m.index! + tudo.length;
  }
  if (ultimo < texto.length) out.push(<Fragment key={`${chave}f`}>{textoComLinks(texto.slice(ultimo), CLASSE_LINK, `${chave}f-`)}</Fragment>);
  return out;
}

export function TextoRico({ texto, className }: { texto: string; className?: string }) {
  // O ClickUp escapa pontuação do markdown ("1\." "\-"): tira a barra, que só atrapalha na leitura.
  const limpo = texto.replace(/\\([.\-*_#>!()\[\]`+])/g, '$1');
  const linhas = limpo.split('\n');
  return (
    <div className={cn('space-y-1 break-words text-sm leading-relaxed', className)}>
      {linhas.map((l, n) => {
        if (l.trim() === '') return <div key={n} className="h-2" />;
        if (/^-{3,}$/.test(l.trim())) return <hr key={n} className="my-2 border-grafite-elevado" />;
        const lista = /^(\s*)([-*]|\d+\.)\s+(\[[ x]\]\s+)?(.*)$/.exec(l);
        if (lista) {
          const marcado = lista[3] ? /x/.test(lista[3]) : null;
          const marcador = marcado === null ? (/\d/.test(lista[2]!) ? lista[2]! : '•') : marcado ? '☑' : '☐';
          return <p key={n} className="flex gap-2" style={{ paddingLeft: Math.min(lista[1]!.length, 8) * 6 }}><span aria-hidden className="shrink-0 text-nevoa">{marcador}</span><span>{inline(lista[4]!, `${n}`)}</span></p>;
        }
        const titulo = /^(#{1,3})\s+(.*)$/.exec(l);
        if (titulo) return <p key={n} className="mt-2 font-semibold">{inline(titulo[2]!, `${n}`)}</p>;
        return <p key={n}>{inline(l, `${n}`)}</p>;
      })}
    </div>
  );
}
