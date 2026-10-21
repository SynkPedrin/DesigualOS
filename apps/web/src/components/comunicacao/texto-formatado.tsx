'use client';

import { Fragment, type ReactNode } from 'react';
import { textoComLinks } from '@/lib/links-no-texto';
import { cn } from '@/lib/utils';

/**
 * TEXTO FORMATADO DA MENSAGEM — formatação básica no estilo que as pessoas
 * já digitam: **negrito**, _itálico_, ~~riscado~~, `código`, bloco ``` ```,
 * listas com "- " ou "1. ", links e @menções.
 *
 * Nada de HTML: o texto é quebrado em pedaços e cada pedaço vira um elemento
 * React com o texto dentro. Uma mensagem com <script> mostra "<script>" na tela
 * e não executa nada. É por isso que não existe dangerouslySetInnerHTML aqui.
 */

const LINK = 'text-roxo-eletrico underline underline-offset-2 hover:opacity-80';

function inline(texto: string, mencoes: string[], meuNome: string | null, chave: string): ReactNode[] {
  // 1) código inline protege o que está dentro de qualquer outra formatação
  const pedacos = texto.split(/(`[^`\n]+`)/g);
  return pedacos.flatMap((p, i): ReactNode[] => {
    if (/^`[^`\n]+`$/.test(p)) return [<code key={`${chave}c${i}`} className="rounded bg-carbono/40 px-1 py-0.5 font-mono text-[0.85em]">{p.slice(1, -1)}</code>];
    return enfatizar(p, mencoes, meuNome, `${chave}e${i}`);
  });
}

function enfatizar(texto: string, mencoes: string[], meuNome: string | null, chave: string): ReactNode[] {
  const re = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<![\w*])_[^_\n]+_(?![\w])|(?<![\w*])\*[^*\n]+\*(?![\w*]))/g;
  return texto.split(re).flatMap((p, i): ReactNode[] => {
    const k = `${chave}${i}`;
    if (/^\*\*[^*\n]+\*\*$/.test(p)) return [<strong key={k} className="font-semibold">{mencionar(p.slice(2, -2), mencoes, meuNome, k)}</strong>];
    if (/^~~[^~\n]+~~$/.test(p)) return [<s key={k}>{mencionar(p.slice(2, -2), mencoes, meuNome, k)}</s>];
    if (/^_[^_\n]+_$/.test(p) || /^\*[^*\n]+\*$/.test(p)) return [<em key={k}>{mencionar(p.slice(1, -1), mencoes, meuNome, k)}</em>];
    return mencionar(p, mencoes, meuNome, k);
  });
}

function mencionar(texto: string, mencoes: string[], meuNome: string | null, chave: string): ReactNode[] {
  if (mencoes.length === 0) return textoComLinks(texto, LINK, chave);
  const nomes = mencoes.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return texto.split(new RegExp(`(@(?:${nomes.join('|')}))`, 'g')).flatMap((p, i): ReactNode[] => {
    if (p.startsWith('@') && mencoes.includes(p.slice(1))) {
      return [<span key={`${chave}m${i}`} className={cn('rounded px-0.5 font-medium', p.slice(1) === meuNome ? 'bg-sinal/20 text-sinal' : 'bg-roxo-eletrico/20 text-roxo-eletrico')}>{p}</span>];
    }
    return textoComLinks(p, LINK, `${chave}l${i}-`);
  });
}

type Bloco = { tipo: 'codigo'; texto: string } | { tipo: 'lista'; ordenada: boolean; itens: string[] } | { tipo: 'paragrafo'; texto: string };

export function blocosDe(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  const partes = texto.split(/```/);
  partes.forEach((parte, i) => {
    if (i % 2 === 1) { blocos.push({ tipo: 'codigo', texto: parte.replace(/^[a-z]*\n/i, '').replace(/\n$/, '') }); return; }
    let paragrafo: string[] = [];
    let lista: { ordenada: boolean; itens: string[] } | null = null;
    const fecharParagrafo = () => { if (paragrafo.length) { blocos.push({ tipo: 'paragrafo', texto: paragrafo.join('\n') }); paragrafo = []; } };
    const fecharLista = () => { if (lista) { blocos.push({ tipo: 'lista', ...lista }); lista = null; } };
    for (const linha of parte.split('\n')) {
      const marcador = /^\s*[-*•]\s+(.+)$/.exec(linha);
      const numero = /^\s*\d+[.)]\s+(.+)$/.exec(linha);
      if (marcador || numero) {
        fecharParagrafo();
        const ordenada = Boolean(numero);
        if (!lista || lista.ordenada !== ordenada) { fecharLista(); lista = { ordenada, itens: [] }; }
        lista.itens.push((marcador ?? numero)![1]!);
      } else {
        fecharLista();
        paragrafo.push(linha);
      }
    }
    fecharLista();
    fecharParagrafo();
  });
  // Tira parágrafos vazios das pontas criados pelas cercas ```.
  return blocos.filter((b, i) => !(b.tipo === 'paragrafo' && !b.texto.trim() && (i === 0 || i === blocos.length - 1)));
}

export function TextoFormatado({ texto, mencoes = [], meuNome = null, className }: { texto: string; mencoes?: string[]; meuNome?: string | null; className?: string }) {
  const blocos = blocosDe(texto);
  return (
    <div className={cn('space-y-1 break-words text-sm leading-relaxed text-branco-cru [overflow-wrap:anywhere]', className)}>
      {blocos.map((b, i) => {
        if (b.tipo === 'codigo') return <pre key={i} className="overflow-x-auto rounded-md border border-grafite-elevado bg-carbono/50 p-2 font-mono text-[12px] leading-snug"><code>{b.texto}</code></pre>;
        if (b.tipo === 'lista') {
          const Tag = b.ordenada ? 'ol' : 'ul';
          return <Tag key={i} className={cn('space-y-0.5 pl-5', b.ordenada ? 'list-decimal' : 'list-disc')}>{b.itens.map((item, j) => <li key={j}>{inline(item, mencoes, meuNome, `${i}-${j}-`)}</li>)}</Tag>;
        }
        return <p key={i} className="whitespace-pre-wrap">{b.texto.split('\n').map((linha, j, todas) => <Fragment key={j}>{inline(linha, mencoes, meuNome, `${i}-${j}-`)}{j < todas.length - 1 ? '\n' : ''}</Fragment>)}</p>;
      })}
    </div>
  );
}
