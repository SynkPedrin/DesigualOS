'use client';

import { Fragment } from 'react';
import { cn } from '@/lib/utils';

/**
 * Texto de comentário/descrição com LINKS CLICÁVEIS. Entende: [texto](url), [DT-9](/daily-tasks?task=…),
 * endereços soltos (https://…), **negrito**, `código`, listas ("- ", "1. ", "- [x] "), separador "---" e menção @[Nome](id).
 * Só abre http(s), mailto e caminhos internos — nunca `javascript:`. Links externos abrem em outra aba.
 */
const TOKEN = /(\[[^\]\n]+\]\((?:https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\))|(@\[[^\]]+\]\([0-9a-f-]{36}\))|(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/gi;

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  const interno = href.startsWith('/');
  return <a href={href} {...(interno ? {} : { target: '_blank', rel: 'noreferrer noopener' })} className="break-all text-sinal underline decoration-sinal/40 underline-offset-2 hover:decoration-sinal" onClick={(e) => e.stopPropagation()}>{children}</a>;
}

function inline(texto: string, chave: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(TOKEN)) {
    if (m.index! > ultimo) out.push(<Fragment key={`${chave}t${i++}`}>{texto.slice(ultimo, m.index)}</Fragment>);
    const [tudo, md, mencao, negrito, codigo, url] = m;
    if (md) { const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(md)!; out.push(<Link key={`${chave}l${i++}`} href={mm[2]!}>{mm[1]}</Link>); }
    else if (mencao) { const mm = /^@\[([^\]]+)\]/.exec(mencao)!; out.push(<span key={`${chave}m${i++}`} className="rounded bg-sinal/15 px-1 text-sinal">@{mm[1]}</span>); }
    else if (negrito) out.push(<strong key={`${chave}b${i++}`} className="font-semibold">{negrito.slice(2, -2)}</strong>);
    else if (codigo) out.push(<code key={`${chave}c${i++}`} className="rounded bg-carbono px-1 font-mono text-[0.85em]">{codigo.slice(1, -1)}</code>);
    else if (url) out.push(<Link key={`${chave}u${i++}`} href={url}>{url.length > 70 ? `${url.slice(0, 67)}…` : url}</Link>);
    ultimo = m.index! + tudo.length;
  }
  if (ultimo < texto.length) out.push(<Fragment key={`${chave}f`}>{texto.slice(ultimo)}</Fragment>);
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
