'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, ImageOff, MoreVertical } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';
import { OBJECTIVE_LABEL, type HubCreative } from '@/lib/api/media';
import { dash, int, money, pct } from '../format';
import { ProviderLogo, StatusPill } from './hub-parts';
import { Sparkline } from '../media-charts';

function Cover({ ad, className }: { ad: HubCreative; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = ad.creative?.imageUrl ?? ad.creative?.thumbnailUrl ?? null;
  // Anúncio de pesquisa (Google) não tem imagem: a capa é o próprio texto do anúncio.
  if (!src && (ad.creative?.title || ad.creative?.body)) {
    return (
      <div className={cn('flex flex-col justify-center gap-1.5 overflow-hidden bg-gradient-to-br from-roxo-eletrico/15 via-carbono to-carbono p-4', className)}>
        {ad.creative?.title && <p className="line-clamp-3 text-sm font-semibold leading-snug text-roxo-eletrico">{ad.creative.title}</p>}
        {ad.creative?.linkUrl && <p className="truncate text-[11px] text-sinal">{ad.creative.linkUrl.replace(/^https?:\/\//, '')}</p>}
        {ad.creative?.body && <p className="line-clamp-3 text-xs leading-snug text-nevoa">{ad.creative.body}</p>}
      </div>
    );
  }
  if (!src || failed) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 bg-carbono text-nevoa', className)}>
        <ImageOff size={22} />
        <span className="text-[11px]">Prévia indisponível</span>
      </div>
    );
  }
  // URL assinada e temporária do Meta: precisa do fallback acima quando expira (por isso <img> e não next/image).
  return <img src={src} alt={ad.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn('object-cover', className)} />;
}

const href = (ad: HubCreative) => `/midias/${ad.clientId}?conta=${encodeURIComponent(ad.accountId)}&aba=criativos`;

function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'accent' }) {
  return <span className={cn('max-w-full truncate rounded-md border px-2 py-0.5 text-[11px] leading-4', tone === 'accent' ? 'border-roxo-eletrico/30 bg-roxo-eletrico/10 text-roxo-eletrico' : 'border-grafite-elevado bg-carbono/60 text-nevoa')}>{children}</span>;
}

export function CreativeCard({ ad }: { ad: HubCreative }) {
  const [menu, setMenu] = useState(false);
  const obj = ad.objective ? (OBJECTIVE_LABEL[ad.objective] ?? ad.objective) : null;
  return (
    <Surface className="group flex flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:border-roxo-eletrico/50 hover:shadow-elevated">
      <Link href={href(ad)} className="relative block" aria-label={`Abrir ${ad.name} em ${ad.clientName}`}>
        <Cover ad={ad} className="aspect-[4/3] w-full" />
        <div className="absolute left-2 top-2"><StatusPill status={ad.status} /></div>
        <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg bg-carbono/85 shadow-sm backdrop-blur"><ProviderLogo provider={ad.provider} size={16} /></span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="truncate text-sm font-semibold text-branco-cru" title={ad.name}>{ad.name}</p>
          <p className="truncate text-xs text-nevoa" title={ad.clientName}>{ad.clientName}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {obj && <Chip tone="accent">{obj}</Chip>}
          {ad.campaignName && <Chip>{ad.campaignName}</Chip>}
        </div>
        <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2 border-t border-grafite-elevado/70 pt-2.5">
          <Metric value={money(ad.spend, ad.currency)} label="Investido" strong />
          <Metric value={ad.results === null ? dash : int(ad.results)} label="Resultados" strong />
          <Metric value={pct(ad.ctr)} label="CTR" />
          <Metric value={money(ad.cpc, ad.currency)} label="CPC" />
        </dl>
        <div className="flex items-center justify-between gap-2">
          <Sparkline values={ad.spark} width={96} height={20} />
          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} onBlur={() => setTimeout(() => setMenu(false), 120)} aria-label="Mais opções" aria-expanded={menu} className="rounded-md p-1 text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><MoreVertical size={16} /></button>
            {menu && (
              <div className="absolute bottom-full right-0 z-10 mb-1 w-44 rounded-md border border-grafite-elevado bg-grafite p-1 shadow-elevated">
                <Link href={href(ad)} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><ExternalLink size={13} /> Abrir na conta</Link>
                <Link href={`/midias/${ad.clientId}?conta=${encodeURIComponent(ad.accountId)}&aba=campanhas`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">Ver campanhas</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </Surface>
  );
}

function Metric({ value, label, strong = false }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dd className={cn('truncate tabular-nums text-branco-cru', strong ? 'font-heading text-base font-semibold leading-tight' : 'text-sm font-medium leading-tight')}>{value}</dd>
      <dt className="text-[11px] text-nevoa">{label}</dt>
    </div>
  );
}

export function CreativeRow({ ad }: { ad: HubCreative }) {
  return (
    <Link href={href(ad)} className="grid grid-cols-[3.5rem_minmax(0,1.6fr)_minmax(0,1fr)_repeat(4,minmax(0,0.7fr))] items-center gap-3 border-b border-grafite-elevado/60 px-3 py-2 transition-colors last:border-0 hover:bg-grafite-elevado/30">
      <Cover ad={ad} className="aspect-square w-14 rounded-md" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-branco-cru">{ad.name}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-nevoa"><ProviderLogo provider={ad.provider} size={12} />{ad.clientName}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-nevoa">{ad.campaignName ?? dash}</p>
        <StatusPill status={ad.status} />
      </div>
      <p className="text-right text-sm tabular-nums text-branco-cru">{money(ad.spend, ad.currency)}</p>
      <p className="text-right text-sm tabular-nums text-branco-cru">{ad.results === null ? dash : int(ad.results)}</p>
      <p className="text-right text-sm tabular-nums text-nevoa">{pct(ad.ctr)}</p>
      <p className="text-right text-sm tabular-nums text-nevoa">{money(ad.cpc, ad.currency)}</p>
    </Link>
  );
}
