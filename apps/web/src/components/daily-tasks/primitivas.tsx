'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Circle, Flag } from 'lucide-react';
import { PRIORIDADES, type WorkMember, type WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import { diaEmSaoPaulo, urgenciaDoPrazo } from '@/lib/prazo';

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

/**
 * Menu que abre junto ao gatilho e fecha ao clicar fora ou apertar Esc.
 * Posição FIXA calculada pelo retângulo do gatilho: dentro da gaveta (que rola) ou de uma tabela com
 * overflow, um menu "absolute" era cortado ou ficava fora da tela. Vira para cima quando falta espaço embaixo.
 */
export function Popover({ trigger, children, align = 'left', label }: { trigger: React.ReactNode; children: (fechar: () => void) => React.ReactNode; align?: 'left' | 'right'; label: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; maxH: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const aberto = pos !== null;
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPos(null); } };
    const rola = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('wheel', rola, true);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc, true); window.removeEventListener('wheel', rola, true); };
  }, [aberto]);
  const abrir = () => {
    if (aberto) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    const abaixo = window.innerHeight - r.bottom - 8;
    const acima = r.top - 8;
    const emBaixo = abaixo >= 220 || abaixo >= acima;
    setPos({
      ...(emBaixo ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
      ...(align === 'right' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.min(r.left, window.innerWidth - 200) }),
      maxH: Math.max(160, Math.min(320, emBaixo ? abaixo : acima)),
    });
  };
  return (
    <div ref={ref} className="relative inline-block">
      <button ref={btn} type="button" aria-label={label} aria-expanded={aberto} onClick={(e) => { e.stopPropagation(); abrir(); }} className="rounded px-1 py-0.5 hover:bg-grafite-elevado">
        {trigger}
      </button>
      {pos && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, maxHeight: pos.maxH }} className="z-[60] min-w-44 overflow-y-auto rounded-md border border-grafite-elevado bg-carbono p-1 shadow-elevated">
          {children(() => setPos(null))}
        </div>
      )}
    </div>
  );
}

export function StatusPill({ nome, cor, categoria, contagem, tamanho = 'md' }: { nome: string; cor: string; categoria?: string; contagem?: number; tamanho?: 'sm' | 'md' }) {
  const feito = categoria === 'done';
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span title={nome} className={cn('inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded font-semibold uppercase tracking-wide text-white', tamanho === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]')} style={{ background: cor }}>
        {feito ? <CheckCircle2 size={12} className="shrink-0" /> : <Circle size={11} className="shrink-0" />}
        <span className="truncate">{nome}</span>
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

/**
 * Prazo numa linha só, do tamanho da coluna: a data e, colado, o que ela significa. Vence hoje é verde cheio;
 * atrasada é vermelho no texto (o selo grande do resto do app empurrava a linha e tampava a prioridade).
 */
export function DueDate({ tarefa }: { tarefa: Pick<WorkTaskWire, 'dueAt' | 'completedAt'> }) {
  if (!tarefa.dueAt) return <Calendar size={15} className="text-nevoa/50" aria-label="Sem data" />;
  const d = new Date(tarefa.dueAt);
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', ...(diaEmSaoPaulo(d).slice(0, 4) !== diaEmSaoPaulo(new Date()).slice(0, 4) ? { year: '2-digit' } : {}) });
  if (tarefa.completedAt) return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-sucesso"><CheckCircle2 size={12} aria-hidden />{data}</span>;
  const u = urgenciaDoPrazo(tarefa.dueAt);
  if (u === 'hoje') return <span className="inline-flex items-center whitespace-nowrap rounded bg-sucesso px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-carbono">Hoje</span>;
  if (u === 'atrasado') {
    const dias = Math.max(1, Math.round((Date.parse(`${diaEmSaoPaulo(new Date())}T00:00:00Z`) - Date.parse(`${diaEmSaoPaulo(d)}T00:00:00Z`)) / 86_400_000));
    return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-red-400" title={`Atrasada desde ${data}`}><AlertTriangle size={12} aria-hidden />{data}<span className="text-[11px] text-red-400/80">· {dias}d</span></span>;
  }
  if (u === 'amanha') return <span className="whitespace-nowrap text-xs font-medium text-lilas">Amanhã</span>;
  return <span className="whitespace-nowrap text-xs text-nevoa">{data}</span>;
}
