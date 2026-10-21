'use client';

import Image from 'next/image';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { MediaHub, MediaProvider } from '@/lib/api/media';
import { Sparkline } from '../media-charts';

export function ProviderLogo({ provider, size = 16, className }: { provider: MediaProvider; size?: number; className?: string }) {
  return (
    <Image
      src={provider === 'meta' ? '/logos/meta.png' : '/logos/google-ads.webp'}
      alt={provider === 'meta' ? 'Meta Ads' : 'Google Ads'}
      width={size}
      height={size}
      unoptimized
      className={cn('shrink-0 rounded-[4px] object-contain', className)}
    />
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Ativa', cls: 'bg-sinal/90 text-carbono' },
  PAUSED: { label: 'Pausada', cls: 'bg-grafite-elevado/95 text-branco-cru' },
  CAMPAIGN_PAUSED: { label: 'Campanha pausada', cls: 'bg-grafite-elevado/95 text-branco-cru' },
  ADSET_PAUSED: { label: 'Conjunto pausado', cls: 'bg-grafite-elevado/95 text-branco-cru' },
  DISAPPROVED: { label: 'Reprovada', cls: 'bg-erro/90 text-branco-cru' },
  WITH_ISSUES: { label: 'Com problemas', cls: 'bg-aviso/90 text-carbono' },
  PENDING_REVIEW: { label: 'Em análise', cls: 'bg-aviso/90 text-carbono' },
};

export function StatusPill({ status }: { status: string | null }) {
  const s = (status && STATUS[status]) || { label: status ?? '—', cls: 'bg-grafite-elevado/95 text-branco-cru' };
  return <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4 shadow-sm backdrop-blur', s.cls)}>{s.label}</span>;
}

/** Cartão de indicador do topo: ícone tingido, valor grande, variação e minigráfico. */
export function KpiTile({
  icon,
  tint,
  label,
  value,
  delta,
  invert = false,
  spark,
  sparkTone,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  delta?: number | null | undefined;
  invert?: boolean;
  spark?: Array<number | null> | undefined;
  sparkTone?: string;
  hint?: string | undefined;
  loading?: boolean;
}) {
  const good = delta === null || delta === undefined ? null : invert ? delta < 0 : delta > 0;
  const flat = delta !== null && delta !== undefined && Math.abs(delta) < 0.5;
  return (
    <Surface className="relative overflow-hidden p-3.5" style={{ containerType: 'inline-size' }}>
      <div className="flex items-center gap-2">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tint)}>{icon}</span>
        <p className="truncate text-xs text-nevoa">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <>
          <p className="mt-2 whitespace-nowrap font-heading font-semibold leading-none tracking-tight tabular-nums text-branco-cru" style={{ fontSize: 'clamp(1.05rem, 9.5cqw, 1.65rem)' }}>{value}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className={cn('flex items-center gap-1 text-xs font-semibold tabular-nums', delta === null || delta === undefined ? 'text-nevoa' : flat ? 'text-nevoa' : good ? 'text-sinal' : 'text-erro')}>
              {delta === null || delta === undefined ? (
                <span className="font-normal">{hint ?? 'sem base'}</span>
              ) : (
                <>
                  {delta > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </>
              )}
            </p>
            {spark && spark.length > 1 && <Sparkline values={spark} tone={sparkTone ?? 'text-roxo-eletrico'} width={92} height={26} />}
          </div>
        </>
      )}
    </Surface>
  );
}

const DOT = { critical: 'bg-erro', warning: 'bg-aviso', info: 'bg-roxo-eletrico' } as const;

export function AttentionPanel({ items, loading }: { items: MediaHub['attention'] | undefined; loading: boolean }) {
  return (
    <Surface className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-branco-cru">
          <span className="flex size-7 items-center justify-center rounded-lg bg-roxo-eletrico/15 text-roxo-eletrico"><AlertTriangle size={14} /></span>
          Precisa de atenção
        </h2>
        {items && items.length > 0 && <span className="rounded-full bg-grafite-elevado px-2 py-0.5 text-[11px] tabular-nums text-nevoa">{items.length}</span>}
      </div>
      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : !items || items.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-sm text-nevoa"><CheckCircle2 size={15} className="text-sinal" /> Toda conta está respondendo e sem alerta aberto.</p>
      ) : (
        <ul className="divide-y divide-grafite-elevado/70">
          {items.map((a) => {
            const body = (
              <div className="flex items-start gap-2.5 py-2.5">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[a.tone])} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-branco-cru">{a.title}</p>
                  <p className="line-clamp-2 text-xs text-nevoa">{a.detail}</p>
                </div>
              </div>
            );
            return <li key={a.id}>{a.clientId ? <Link href={`/midias/${a.clientId}`} className="block rounded-md transition-colors hover:bg-grafite-elevado/40">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </Surface>
  );
}

const INSIGHT_ICON = { good: TrendingUp, warn: AlertTriangle, info: Info } as const;
const INSIGHT_TONE = { good: 'text-sinal bg-sinal/10', warn: 'text-aviso bg-aviso/10', info: 'text-roxo-eletrico bg-roxo-eletrico/10' } as const;

export function InsightsPanel({ items, loading }: { items: MediaHub['insights'] | undefined; loading: boolean }) {
  return (
    <Surface className="border-sinal/30 bg-sinal/[0.04] p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-sinal/15 text-sinal"><Sparkles size={14} /></span>
        <h2 className="font-heading text-sm font-semibold text-branco-cru">Insights automáticos</h2>
      </div>
      <p className="mb-3 text-[11px] text-nevoa">Regras sobre os seus números do período. Cada linha traz o dado que a sustenta.</p>
      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : !items || items.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-nevoa"><Lightbulb size={15} /> Sem base suficiente para comparar neste período.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((i) => {
            const Icon = INSIGHT_ICON[i.tone];
            return (
              <li key={i.id} className="flex items-start gap-2.5">
                <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', INSIGHT_TONE[i.tone])}><Icon size={13} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug text-branco-cru">{i.title}</p>
                  <p className="text-xs leading-snug text-nevoa">{i.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function ActivityPanel({ items, loading }: { items: MediaHub['activity'] | undefined; loading: boolean }) {
  return (
    <Surface className="p-4">
      <h2 className="mb-3 font-heading text-sm font-semibold text-branco-cru">Atividade recente</h2>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !items || items.length === 0 ? (
        <p className="py-2 text-sm text-nevoa">Nenhuma atividade de mídia registrada ainda.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-roxo-eletrico/20 text-[11px] font-semibold text-roxo-eletrico">{(a.who ?? 'S').slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-branco-cru"><span className="font-medium">{a.who ?? 'Sistema'}</span> <span className="text-nevoa">{a.action}</span>{a.clientName ? <span className="text-nevoa"> · {a.clientName}</span> : null}</p>
                {a.detail && <p className="truncate text-xs text-nevoa">{a.detail}</p>}
              </div>
              <span className="shrink-0 text-[11px] text-nevoa">{ago(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
