'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar, CheckCircle2, Circle, Flag } from 'lucide-react';
import { PRIORIDADES, type WorkMember, type WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';

const CORES = ['#7c3aed', '#0ea5e9', '#f97316', '#10b981', '#ec4899', '#eab308', '#6366f1', '#14b8a6'];

export function Avatar({ nome, url, size = 24 }: { nome: string; url?: string | null | undefined; size?: number }) {
  const cor = CORES[[...nome].reduce((a, c) => a + c.charCodeAt(0), 0) % CORES.length];
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return url ? (
    <img src={url} alt={nome} title={nome} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span title={nome} className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: cor, fontSize: size * 0.4 }}>
      {iniciais || '?'}
    </span>
  );
}

export function AvatarStack({ ids, membros, size = 24 }: { ids: string[]; membros: Map<string, WorkMember>; size?: number }) {
  if (ids.length === 0) return <span title="Sem responsável" className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-nevoa/40 text-nevoa/60"><Circle size={10} /></span>;
  return (
    <span className="flex items-center -space-x-1.5">
      {ids.slice(0, 3).map((id) => {
        const m = membros.get(id);
        return <span key={id} className="rounded-full ring-2 ring-grafite"><Avatar nome={m?.name ?? 'Fora da equipe'} url={m?.avatarUrl} size={size} /></span>;
      })}
      {ids.length > 3 && <span className="ml-1.5 pl-1.5 text-[10px] text-nevoa">+{ids.length - 3}</span>}
    </span>
  );
}

/** Menu que abre sob o gatilho e fecha ao clicar fora ou apertar Esc. */
export function Popover({ trigger, children, align = 'left', label }: { trigger: React.ReactNode; children: (fechar: () => void) => React.ReactNode; align?: 'left' | 'right'; label: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-label={label} aria-expanded={aberto} onClick={(e) => { e.stopPropagation(); setAberto((v) => !v); }} className="rounded px-1 py-0.5 hover:bg-grafite-elevado">
        {trigger}
      </button>
      {aberto && (
        <div onClick={(e) => e.stopPropagation()} className={cn('absolute z-40 mt-1 min-w-44 rounded-md border border-grafite-elevado bg-carbono p-1 shadow-elevated', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setAberto(false))}
        </div>
      )}
    </div>
  );
}

export function StatusPill({ nome, cor, categoria, contagem, tamanho = 'md' }: { nome: string; cor: string; categoria?: string; contagem?: number; tamanho?: 'sm' | 'md' }) {
  const feito = categoria === 'done';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide text-white', tamanho === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]')} style={{ background: cor }}>
        {feito ? <CheckCircle2 size={12} /> : <Circle size={11} />}
        {nome}
      </span>
      {contagem !== undefined && <span className="text-xs text-nevoa">{contagem}</span>}
    </span>
  );
}

export function StatusDot({ cor, feito }: { cor: string; feito: boolean }) {
  return feito ? <CheckCircle2 size={16} style={{ color: cor }} className="shrink-0" /> : <Circle size={16} style={{ color: cor }} className="shrink-0" strokeDasharray="3 2" />;
}

export function PriorityFlag({ valor, comTexto }: { valor: number; comTexto?: boolean }) {
  const p = PRIORIDADES[valor] ?? PRIORIDADES[0]!;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: p.color || undefined }}>
      <Flag size={14} fill={p.color || 'none'} className={p.color ? '' : 'text-nevoa/50'} />
      {(comTexto || valor !== 0) && <span className={p.color ? '' : 'text-nevoa/60'}>{valor === 0 ? 'Definir' : p.label}</span>}
    </span>
  );
}

export function formatarData(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Vencida e aberta = vermelho · feita = verde · hoje = laranja, como no ClickUp. */
export function DueDate({ tarefa }: { tarefa: Pick<WorkTaskWire, 'dueAt' | 'completedAt'> }) {
  if (!tarefa.dueAt) return <Calendar size={15} className="text-nevoa/50" aria-label="Sem data" />;
  const venc = new Date(tarefa.dueAt);
  const hoje = new Date();
  const mesmoDia = venc.toDateString() === hoje.toDateString();
  const cor = tarefa.completedAt ? 'text-sucesso' : venc < hoje && !mesmoDia ? 'text-red-400' : mesmoDia ? 'text-aviso' : 'text-nevoa';
  return <span className={cn('text-xs', cor)}>{formatarData(tarefa.dueAt)}</span>;
}
