'use client';

import type { LucideIcon } from 'lucide-react';
import { Flag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PRIORIDADES } from '@/hooks/use-work';
import { cn } from '@/lib/utils';

/** Cartão de número do topo da tela. Clicável quando filtra a lista. */
export function StatCard({ icone: Icone, rotulo, valor, detalhe, tom = 'neutro', onClick, ativo }: { icone: LucideIcon; rotulo: string; valor: number | string; detalhe?: string | undefined; tom?: 'neutro' | 'verde' | 'vermelho' | 'amarelo' | 'roxo'; onClick?: () => void; ativo?: boolean }) {
  const cor = { neutro: 'bg-grafite-elevado text-nevoa', verde: 'bg-sucesso/15 text-sucesso', vermelho: 'bg-red-500/15 text-red-400', amarelo: 'bg-aviso/15 text-aviso', roxo: 'bg-roxo-eletrico/15 text-roxo-eletrico' }[tom];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick ? ativo : undefined} className={cn('flex items-center gap-3 rounded-xl border bg-grafite px-3 py-2 text-left', ativo ? 'border-sinal' : 'border-grafite-elevado', onClick && 'transition-colors hover:border-sinal/60')}>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', cor)}><Icone size={17} /></span>
      <span className="min-w-0">
        <span className="block text-xs text-nevoa">{rotulo}</span>
        <span className="block font-heading text-xl font-semibold leading-tight text-branco-cru">{valor}</span>
        {detalhe && <span className="block truncate text-[11px] text-nevoa">{detalhe}</span>}
      </span>
    </Tag>
  );
}

export function BarraDeProgresso({ pct, titulo }: { pct: number; titulo?: string }) {
  const cor = pct >= 100 ? 'bg-sucesso' : pct >= 50 ? 'bg-sucesso' : pct > 0 ? 'bg-aviso' : 'bg-grafite-elevado';
  return (
    <span className="flex items-center gap-2 text-xs text-nevoa" title={titulo}>
      <span className="h-1.5 w-12 overflow-hidden rounded bg-grafite-elevado"><span className={cn('block h-full rounded', cor)} style={{ width: `${Math.max(pct, 0)}%` }} /></span>
      <span className="w-8 tabular-nums">{pct}%</span>
    </span>
  );
}

const BADGE_PRIORIDADE: Record<number, string> = { 1: 'bg-red-500/15 text-red-400', 2: 'bg-aviso/15 text-aviso', 3: 'bg-sky-500/15 text-sky-400', 4: 'bg-grafite-elevado text-nevoa', 0: 'bg-transparent text-nevoa/60' };
export function EmblemaDePrioridade({ valor }: { valor: number }) {
  const p = PRIORIDADES[valor] ?? PRIORIDADES[0]!;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', BADGE_PRIORIDADE[valor] ?? BADGE_PRIORIDADE[0])}>
      <Flag size={11} fill={valor ? 'currentColor' : 'none'} />{valor === 0 ? 'Definir' : p.label}
    </span>
  );
}

/** Data + frase relativa ("há 5 dias", "hoje", "em 2 dias"), com a cor que diz se é problema. */
export function prazoRelativo(dueAt: string | null, feita: boolean): { data: string; texto: string; cor: string } | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(d); alvo.setHours(0, 0, 0, 0);
  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  if (feita) return { data, texto: dias < 0 ? `${-dias} d atrás` : dias === 0 ? 'hoje' : `em ${dias} d`, cor: 'text-sucesso' };
  if (dias < 0) return { data, texto: `há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}`, cor: 'text-red-400' };
  if (dias === 0) return { data, texto: 'hoje', cor: 'text-aviso' };
  return { data, texto: `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, cor: 'text-nevoa' };
}

/** Andamento da tarefa: subtarefas concluídas quando existem; senão, o que o status diz. */
export function andamento(t: { subtaskCount: number; subtaskDone: number; status: { category: string } | null; completedAt: string | null }): number {
  if (t.completedAt || t.status?.category === 'done') return 100;
  if (t.subtaskCount > 0) return Math.round((t.subtaskDone / t.subtaskCount) * 100);
  return ({ todo: 0, active: 40, review: 75, blocked: 20, cancelled: 0 } as Record<string, number>)[t.status?.category ?? 'todo'] ?? 0;
}

/**
 * Região que rola sozinha enquanto o resto da tela fica parado. As bordas
 * esmaecem (fade) só do lado em que ainda há conteúdo escondido, para quem
 * olha saber que a lista continua. Abaixo de md não prende altura: no celular
 * a tela inteira rola.
 */
export function AreaRolavel({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [borda, setBorda] = useState({ topo: false, base: false });
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const topo = el.scrollTop > 4;
    const base = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
    setBorda((b) => (b.topo === topo && b.base === base ? b : { topo, base }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [medir]);
  const mascara = `linear-gradient(to bottom, ${borda.topo ? 'transparent 0, #000 36px' : '#000 0'}, ${borda.base ? '#000 calc(100% - 44px), transparent 100%' : '#000 100%'})`;
  return (
    <div
      ref={ref}
      onScroll={medir}
      data-area-rolavel
      style={{ WebkitMaskImage: mascara, maskImage: mascara }}
      className={cn('md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain md:pr-1', className)}
    >
      <div className="space-y-3">{children}</div>
    </div>
  );
}
