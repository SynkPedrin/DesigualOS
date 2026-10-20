'use client';

import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Gráficos do Media Command Center, em SVG puro.
 *
 * Sem biblioteca: são cinco formas simples, o app já carrega três bibliotecas
 * de gráfico para outros usos, e aqui o que importa é controle fino do valor
 * mostrado (rótulo, tooltip, unidade) e do tema (tudo em `currentColor` e nas
 * cores dos tokens). Nenhum gráfico inventa dado: série vazia vira estado vazio.
 */

const compact = (v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

// ── Minigráfico ──────────────────────────────────────────────────────────

export function Sparkline({ values, className, height = 28, width = 96, tone = 'text-roxo-eletrico' }: { values: Array<number | null>; className?: string; height?: number; width?: number; tone?: string }) {
  const id = useId();
  const nums = values.map((v) => v ?? 0);
  if (nums.length < 2 || nums.every((v) => v === 0)) {
    return <span className={cn('inline-block text-[10px] text-nevoa', className)} style={{ width }} aria-hidden>sem veiculação</span>;
  }
  const max = Math.max(...nums);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const step = width / (nums.length - 1);
  const pts = nums.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts.at(-1)!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn(tone, className)} role="img" aria-label="Tendência de investimento no período">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
    </svg>
  );
}

// ── Gráfico combinado: investimento (área) + resultados (barras) ─────────

export interface ComboPoint {
  day: string;
  spend: number | null;
  results: number | null;
  costPerResult: number | null;
}

export function ComboChart({ points, formatMoney, resultLabel, height = 240 }: { points: ComboPoint[]; formatMoney: (v: number | null) => string; resultLabel: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 720;
  const padL = 44;
  const padR = 36;
  const padT = 14;
  const padB = 24;

  const geo = useMemo(() => {
    const spendMax = Math.max(1, ...points.map((p) => p.spend ?? 0));
    const resMax = Math.max(1, ...points.map((p) => p.results ?? 0));
    const innerW = W - padL - padR;
    const innerH = height - padT - padB;
    const slot = innerW / Math.max(1, points.length);
    const xAt = (i: number) => padL + slot * i + slot / 2;
    const ySpend = (v: number) => padT + innerH - (v / spendMax) * innerH;
    const yRes = (v: number) => padT + innerH - (v / resMax) * innerH;
    return { spendMax, resMax, innerH, innerW, slot, xAt, ySpend, yRes };
  }, [points, height]);

  if (points.length === 0 || points.every((p) => (p.spend ?? 0) === 0 && (p.results ?? 0) === 0)) {
    return <p className="flex items-center justify-center text-sm text-nevoa" style={{ height }}>Sem investimento nem resultados nos dias do período.</p>;
  }

  const area = points.map((p, i) => `${geo.xAt(i).toFixed(1)},${geo.ySpend(p.spend ?? 0).toFixed(1)}`);
  const baseY = padT + geo.innerH;
  const hv = hover === null ? null : points[hover];
  const ticks = [0, 0.5, 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Investimento e ${resultLabel.toLowerCase()} por dia`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const y = padT + geo.innerH - t * geo.innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="stroke-grafite-elevado" strokeDasharray="3 4" />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-nevoa" fontSize="10">{t === 0 ? '0' : compact(geo.spendMax * t)}</text>
              <text x={W - padR + 6} y={y + 3} className="fill-sinal" fontSize="10">{t === 0 ? '0' : compact(geo.resMax * t)}</text>
            </g>
          );
        })}
        {/* resultados: barras */}
        {points.map((p, i) => {
          const h = ((p.results ?? 0) / geo.resMax) * geo.innerH;
          return <rect key={`b${p.day}`} x={geo.xAt(i) - Math.max(2, geo.slot * 0.28)} width={Math.max(4, geo.slot * 0.56)} y={baseY - h} height={h} rx="2" className={cn('fill-sinal', hover === i ? 'opacity-90' : 'opacity-45')} />;
        })}
        {/* investimento: área + linha */}
        <g className="text-roxo-eletrico">
          <polygon points={`${geo.xAt(0)},${baseY} ${area.join(' ')} ${geo.xAt(points.length - 1)},${baseY}`} fill={`url(#${id}-a)`} />
          <polyline points={area.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </g>
        {hv && hover !== null && (
          <g>
            <line x1={geo.xAt(hover)} x2={geo.xAt(hover)} y1={padT} y2={baseY} className="stroke-nevoa" strokeDasharray="2 3" />
            <circle cx={geo.xAt(hover)} cy={geo.ySpend(hv.spend ?? 0)} r="4" className="fill-roxo-eletrico stroke-carbono" strokeWidth="2" />
          </g>
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={`x${p.day}`} x={geo.xAt(i)} y={height - 6} textAnchor="middle" className="fill-nevoa" fontSize="10">{p.day.slice(8)}/{p.day.slice(5, 7)}</text>
          ) : null,
        )}
        {/* alvo de mouse por dia */}
        {points.map((p, i) => (
          <rect key={`h${p.day}`} x={padL + geo.slot * i} width={geo.slot} y={padT} height={geo.innerH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${p.day}: investimento ${formatMoney(p.spend)}, ${resultLabel.toLowerCase()} ${p.results ?? 'indisponível'}`} />
        ))}
      </svg>
      {hv && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[160px] rounded-md border border-grafite-elevado bg-carbono/95 px-3 py-2 text-xs shadow-elevated"
          style={{ left: `${Math.min(78, Math.max(2, (geo.xAt(hover) / W) * 100 - 10))}%` }}
        >
          <p className="font-medium text-branco-cru">{new Date(`${hv.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</p>
          <p className="mt-1 flex items-center justify-between gap-3 text-nevoa"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-roxo-eletrico" />Investimento</span><b className="tabular-nums text-branco-cru">{formatMoney(hv.spend)}</b></p>
          <p className="flex items-center justify-between gap-3 text-nevoa"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-sinal" />{resultLabel}</span><b className="tabular-nums text-branco-cru">{hv.results ?? '—'}</b></p>
          <p className="flex items-center justify-between gap-3 text-nevoa"><span>Custo/resultado</span><b className="tabular-nums text-branco-cru">{formatMoney(hv.costPerResult)}</b></p>
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-nevoa">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-roxo-eletrico" />Investimento (eixo esquerdo)</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-sinal" />{resultLabel} (eixo direito)</span>
      </div>
    </div>
  );
}

// ── Barras horizontais com valor ─────────────────────────────────────────

export interface BarItem {
  key: string;
  label: string;
  value: number;
  display: string;
  sub?: string;
  tone?: 'roxo' | 'sinal' | 'aviso' | 'erro';
}

const TONE_FILL = { roxo: 'bg-roxo-eletrico', sinal: 'bg-sinal', aviso: 'bg-aviso', erro: 'bg-erro' } as const;

export function HBars({ items, empty = 'Sem dados no período.' }: { items: BarItem[]; empty?: string }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (items.length === 0 || max <= 0) return <p className="py-6 text-center text-sm text-nevoa">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-branco-cru" title={it.label}>{it.label}</span>
            <span className="shrink-0 tabular-nums font-medium text-branco-cru">{it.display}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-grafite-elevado">
            <div className={cn('h-full rounded-full transition-[width] duration-500', TONE_FILL[it.tone ?? 'roxo'])} style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
          </div>
          {it.sub && <p className="mt-0.5 text-[11px] text-nevoa">{it.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

// ── Rosca ────────────────────────────────────────────────────────────────

const DONUT_FILLS = ['text-roxo-eletrico', 'text-sinal', 'text-aviso', 'text-erro', 'text-nevoa'] as const;
const DONUT_DOTS = ['bg-roxo-eletrico', 'bg-sinal', 'bg-aviso', 'bg-erro', 'bg-nevoa'] as const;

export function Donut({ items, centerLabel, centerValue }: { items: Array<{ key: string; label: string; value: number; display: string }>; centerLabel: string; centerValue: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return <p className="py-6 text-center text-sm text-nevoa">Sem investimento no período.</p>;
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Distribuição do investimento">
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="stroke-grafite-elevado" />
          {items.map((it, i) => {
            const len = (it.value / total) * C;
            const el = <circle key={it.key} cx="70" cy="70" r={R} fill="none" strokeWidth="16" stroke="currentColor" className={DONUT_FILLS[i % DONUT_FILLS.length]} strokeDasharray={`${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-nevoa" fontSize="10">{centerLabel}</text>
        <text x="70" y="82" textAnchor="middle" className="fill-branco-cru" fontSize="14" fontWeight="600">{centerValue}</text>
      </svg>
      <ul className="min-w-[150px] flex-1 space-y-1.5 text-xs">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-nevoa"><i className={cn('size-2 shrink-0 rounded-full', DONUT_DOTS[i % DONUT_DOTS.length])} /><span className="truncate" title={it.label}>{it.label}</span></span>
            <span className="shrink-0 tabular-nums text-branco-cru">{it.display} <span className="text-nevoa">· {Math.round((it.value / total) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Valor com barra atrás, para célula de tabela ─────────────────────────

export function DataBar({ value, max, children, tone = 'bg-roxo-eletrico/25' }: { value: number | null; max: number; children: React.ReactNode; tone?: string }) {
  const pct = value !== null && max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="relative min-w-[96px] overflow-hidden rounded px-2 py-1 text-right tabular-nums">
      <span className={cn('absolute inset-y-0 right-0 rounded', tone)} style={{ width: `${pct}%` }} aria-hidden />
      <span className="relative text-branco-cru">{children}</span>
    </div>
  );
}

/** Chip de variação com cor pelo SENTIDO: para custo, subir é ruim. */
export function DeltaChip({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value === null || value === undefined) return <span className="rounded-full bg-grafite-elevado px-1.5 py-0.5 text-[10px] text-nevoa">sem base</span>;
  const good = invert ? value < 0 : value > 0;
  const neutral = Math.abs(value) < 0.5;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums', neutral ? 'bg-grafite-elevado text-nevoa' : good ? 'bg-sinal/15 text-sinal' : 'bg-erro/15 text-erro')}>
      {value > 0 ? '▲' : value < 0 ? '▼' : '•'} {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  );
}
