'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Eye, LayoutGrid, MousePointerClick, Plus, Rows3, Search, SlidersHorizontal, Table2, Target, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { SemNadaAinda } from '@/components/control/primitives';
import { useHubCreatives, useMediaHub } from '@/hooks/use-media';
import { ApiRequestError } from '@/lib/api/client';
import { MEDIA_PERIODS, OBJECTIVE_LABEL, type MediaPeriod, type MediaProvider } from '@/lib/api/media';
import { cn } from '@/lib/utils';
import { int, money, pct, when } from '../format';
import { CarteiraPorCliente } from './carteira-por-cliente';
import { CreativeCard, CreativeRow } from './hub-gallery';
import { ActivityPanel, AttentionPanel, InsightsPanel, KpiTile, ProviderLogo } from './hub-parts';

type View = 'galeria' | 'lista' | 'tabela';
type Sort = 'spend' | 'results' | 'ctr' | 'costPerResult' | 'active';

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'spend', label: 'Maior investimento' },
  { value: 'results', label: 'Mais resultados' },
  { value: 'ctr', label: 'Melhor CTR' },
  { value: 'costPerResult', label: 'Menor custo por resultado' },
  { value: 'active', label: 'Veiculando mais recentemente' },
];
const STATUSES = [
  { value: '', label: 'Todos os estados' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'PAUSED', label: 'Pausados' },
  { value: 'DISAPPROVED', label: 'Reprovados' },
  { value: 'WITH_ISSUES', label: 'Com problemas' },
];
const PAGE = 24;

const PREF = 'media:hub';
function readPref(): { period?: MediaPeriod; view?: View } {
  try {
    return JSON.parse(window.localStorage.getItem(PREF) ?? '{}');
  } catch {
    return {};
  }
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const select = 'rounded-lg border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru outline-none transition-colors hover:border-nevoa focus:border-roxo-eletrico';

export function MediaHub() {
  const [period, setPeriod] = useState<MediaPeriod>('last_30d');
  const [view, setView] = useState<View>('galeria');
  const [provider, setProvider] = useState<MediaProvider | ''>('');
  const [busca, setBusca] = useState('');
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('');
  const [objective, setObjective] = useState('');
  const [sort, setSort] = useState<Sort>('spend');
  const [withSpend, setWithSpend] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    const p = readPref();
    if (p.period) setPeriod(p.period);
    if (p.view) setView(p.view);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREF, JSON.stringify({ period, view }));
    } catch {
      /* sem storage: a tela funciona igual */
    }
  }, [period, view]);

  const q = useDebounced(busca.trim());
  const hub = useMediaHub(period, true);
  const creatives = useHubCreatives({ period, provider: provider || undefined, accountId: accountId || undefined, q: q || undefined, status: status || undefined, objective: objective || undefined, withSpend, sort, limit });

  // Resposta incompleta (API em versão anterior, ou vazia) não derruba a tela: sem `kpis`/`facets` ela mostra o estado vazio.
  const h = hub.data?.kpis && hub.data.facets ? hub.data : undefined;
  const list = creatives.data?.rows ? creatives.data : undefined;
  const cur = h?.kpis.current;
  const ch = h?.kpis.changes;
  const cc = h?.kpis.currency ?? 'BRL';
  const series = (k: 'spend' | 'impressions' | 'clicks' | 'results' | 'ctr' | 'costPerResult') => h?.kpis.daily.map((d) => d[k]);

  const accountsOfProvider = useMemo(() => (h?.facets.accounts ?? []).filter((a) => !provider || a.provider === provider), [h, provider]);
  const totalAccounts = h?.facets.providers.reduce((s, p) => s + p.accounts, 0) ?? 0;
  const forbidden = hub.error instanceof ApiRequestError && hub.error.status === 403;
  const missingRoute = hub.error instanceof ApiRequestError && hub.error.status === 404;

  const resetPage = () => setLimit(PAGE);

  if (forbidden) {
    return (
      <div className="mx-auto w-full max-w-[1500px]">
        <PageHeader title="Mídias" description="Tráfego pago da carteira." />
        <SemNadaAinda titulo="Mídia não faz parte do seu acesso" explicacao="Esta tela mostra investimento e resultado de campanha. Peça a quem administra a conta para incluir mídia no seu acesso." />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1700px]">
      <PageHeader
        compact
        title="Mídias"
        description="Conecte as contas de anúncios, acompanhe campanhas e gerencie criativos em um só lugar."
        actions={
          <>
            <label className="flex items-center gap-2.5 rounded-xl border border-grafite-elevado bg-carbono/70 px-3 py-2 backdrop-blur">
              <CalendarDays size={18} className="text-nevoa" />
              <span className="leading-tight">
                <span className="block text-[11px] text-nevoa">Período atual</span>
                <span className="block text-sm font-medium tabular-nums text-branco-cru">{h ? `${dm(h.range.since)} – ${dm(h.range.until)}` : '…'}</span>
              </span>
              <select value={period} onChange={(e) => { setPeriod(e.target.value as MediaPeriod); resetPage(); }} aria-label="Período" className="ml-1 cursor-pointer bg-transparent text-xs text-nevoa outline-none hover:text-branco-cru">
                {MEDIA_PERIODS.map((p) => (<option key={p.value} value={p.value} className="bg-grafite text-branco-cru">{p.label}</option>))}
              </select>
            </label>
            <Link href="/studio" className="inline-flex items-center gap-2 rounded-xl bg-roxo-eletrico px-4 py-2.5 text-sm font-semibold text-branco-cru shadow-elevated transition-opacity hover:opacity-90"><Plus size={16} /> Novo criativo</Link>
          </>
        }
      />

      {missingRoute && (
        <Surface className="mb-4 border-aviso/40 bg-aviso/5 p-4 text-sm text-aviso">O servidor da API ainda não tem a nova tela de mídia (está em uma versão anterior). Os dados por cliente continuam na visão “Tabela”.</Surface>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="min-w-0 space-y-4">
          {/* Números da carteira, com tendência. Moeda única; outras moedas ficam de fora e são ditas. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 min-[2100px]:grid-cols-6">
            <KpiTile loading={hub.isPending} icon={<Wallet size={16} />} tint="bg-roxo-eletrico/15 text-roxo-eletrico" label="Investido" value={money(cur?.spend, cc)} delta={ch?.spend} spark={series('spend')} />
            <KpiTile loading={hub.isPending} icon={<Eye size={16} />} tint="bg-sky-500/15 text-sky-400" label="Impressões" value={int(cur?.impressions)} delta={ch?.impressions} spark={series('impressions')} sparkTone="text-sky-400" />
            <KpiTile loading={hub.isPending} icon={<MousePointerClick size={16} />} tint="bg-sinal/15 text-sinal" label="Cliques" value={int(cur?.clicks)} delta={ch?.clicks} spark={series('clicks')} sparkTone="text-sinal" />
            <KpiTile loading={hub.isPending} icon={<BarChart3 size={16} />} tint="bg-roxo-eletrico/15 text-roxo-eletrico" label="CTR" value={pct(cur?.ctr)} delta={ch?.ctr} spark={series('ctr')} />
            <KpiTile loading={hub.isPending} icon={<Target size={16} />} tint="bg-aviso/15 text-aviso" label="Resultados" value={int(cur?.results)} delta={ch?.results} spark={series('results')} sparkTone="text-aviso" />
            <KpiTile loading={hub.isPending} icon={<SlidersHorizontal size={16} />} tint="bg-roxo-eletrico/15 text-roxo-eletrico" label="Custo/result." value={money(cur?.costPerResult, cc)} delta={ch?.costPerResult} invert spark={series('costPerResult')} />
          </div>
          {h && (
            <p className="text-[11px] text-nevoa">
              Valores em {cc}{h.kpis.otherCurrencies.length > 0 ? ` (contas em ${h.kpis.otherCurrencies.join(', ')} não entram nos totais)` : ''} · comparado com {h.previousRange ? `${dm(h.previousRange.since)} – ${dm(h.previousRange.until)}` : 'nenhum período'} · resultados são o tipo que cada conta rastreia (lead, conversa ou conversão) · dados sincronizados {when(h.lastSyncedAt)}
            </p>
          )}

          {/* Plataformas e visões */}
          <Surface className="flex flex-wrap items-center gap-2 p-2">
            <PlatformTab active={provider === ''} onClick={() => { setProvider(''); setAccountId(''); resetPage(); }} label="Todos" count={totalAccounts} />
            {h?.facets.providers.map((p) => (
              <PlatformTab key={p.provider} active={provider === p.provider} onClick={() => { setProvider(p.provider); setAccountId(''); resetPage(); }} label={p.provider === 'meta' ? 'Meta Ads' : 'Google Ads'} count={p.accounts} logo={<ProviderLogo provider={p.provider} size={16} />} />
            ))}
            <div className="ml-auto flex rounded-lg border border-grafite-elevado bg-carbono/50 p-0.5" role="group" aria-label="Modo de visualização">
              {([['galeria', LayoutGrid, 'Galeria'], ['lista', Rows3, 'Lista'], ['tabela', Table2, 'Tabela']] as const).map(([v, Icon, label]) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors', view === v ? 'bg-roxo-eletrico text-branco-cru shadow-sm' : 'text-nevoa hover:text-branco-cru')}><Icon size={14} /> {label}</button>
              ))}
            </div>
          </Surface>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[16rem] flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
              <input value={busca} onChange={(e) => { setBusca(e.target.value); resetPage(); }} placeholder={view === 'tabela' ? 'Buscar cliente…' : 'Buscar criativo, campanha ou cliente…'} aria-label="Buscar" className={cn(select, 'w-full pl-9')} />
            </label>
            {view !== 'tabela' && (
              <>
                <select value={accountId} onChange={(e) => { setAccountId(e.target.value); resetPage(); }} aria-label="Conta" className={cn(select, 'max-w-[15rem]')}>
                  <option value="">Todas as contas</option>
                  {accountsOfProvider.map((a) => (<option key={`${a.provider}:${a.accountId}`} value={a.accountId}>{a.clientName}{a.name && a.name !== a.clientName ? ` · ${a.name}` : ''}</option>))}
                </select>
                <select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} aria-label="Estado" className={select}>
                  {STATUSES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
                <select value={objective} onChange={(e) => { setObjective(e.target.value); resetPage(); }} aria-label="Objetivo" className={select}>
                  <option value="">Todos os objetivos</option>
                  {h?.facets.objectives.map((o) => (<option key={o.objective} value={o.objective}>{OBJECTIVE_LABEL[o.objective] ?? o.objective}</option>))}
                </select>
                <select value={sort} onChange={(e) => { setSort(e.target.value as Sort); resetPage(); }} aria-label="Ordenar por" className={select}>
                  {SORTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-nevoa"><input type="checkbox" checked={!withSpend} onChange={(e) => { setWithSpend(!e.target.checked); resetPage(); }} /> Incluir sem veiculação</label>
              </>
            )}
          </div>

          {view === 'tabela' ? (
            <CarteiraPorCliente busca={busca} />
          ) : (
            <section aria-label="Criativos e campanhas">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-semibold text-branco-cru">Criativos e campanhas</h2>
                  <p className="text-xs text-nevoa">Anúncios de todas as contas vinculadas, com o desempenho do período.</p>
                </div>
                <p className="text-xs tabular-nums text-nevoa">{list ? `${Math.min(limit, list.total)} de ${list.total}` : ''}</p>
              </div>
              {creatives.isPending ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">{Array.from({ length: 8 }).map((_, i) => (<Skeleton key={i} className="h-80 w-full" />))}</div>
              ) : creatives.isError || (!creatives.isPending && !list) ? (
                <SemNadaAinda titulo="Não consegui carregar os criativos" explicacao="A consulta falhou. Tente de novo em instantes; os números do topo seguem valendo." />
              ) : list!.rows.length === 0 ? (
                <SemNadaAinda titulo="Nenhum criativo com estes filtros" explicacao={withSpend ? 'Nenhum anúncio investiu neste período com esses filtros. Marque “Incluir sem veiculação” para ver os pausados.' : 'Ajuste a busca ou os filtros.'} />
              ) : view === 'galeria' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">{list!.rows.map((ad) => (<CreativeCard key={`${ad.provider}:${ad.id}`} ad={ad} />))}</div>
              ) : (
                <Surface className="overflow-hidden">
                  <div className="grid grid-cols-[3.5rem_minmax(0,1.6fr)_minmax(0,1fr)_repeat(4,minmax(0,0.7fr))] gap-3 border-b border-grafite-elevado px-3 py-2 text-[11px] uppercase tracking-wider text-nevoa">
                    <span /> <span>Criativo</span> <span>Campanha</span> <span className="text-right">Investido</span> <span className="text-right">Resultados</span> <span className="text-right">CTR</span> <span className="text-right">CPC</span>
                  </div>
                  {list!.rows.map((ad) => (<CreativeRow key={`${ad.provider}:${ad.id}`} ad={ad} />))}
                </Surface>
              )}
              {list && list.total > limit && (
                <div className="mt-4 flex justify-center">
                  <button type="button" onClick={() => setLimit((l) => l + PAGE)} disabled={creatives.isFetching} className="rounded-lg border border-grafite-elevado px-5 py-2 text-sm text-nevoa transition-colors hover:border-roxo-eletrico hover:text-branco-cru disabled:opacity-50">{creatives.isFetching ? 'Carregando…' : `Carregar mais ${Math.min(PAGE, list.total - limit)}`}</button>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-[11rem] xl:self-start">
          <AttentionPanel items={h?.attention} loading={hub.isPending} />
          <InsightsPanel items={h?.insights} loading={hub.isPending} />
          <ActivityPanel items={h?.activity} loading={hub.isPending} />
        </aside>
      </div>
    </div>
  );
}

function PlatformTab({ active, onClick, label, count, logo }: { active: boolean; onClick: () => void; label: string; count: number; logo?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors', active ? 'bg-roxo-eletrico text-branco-cru shadow-sm' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru')}>
      {logo}
      {label}
      <span className={cn('rounded-md px-1.5 py-0.5 text-xs tabular-nums', active ? 'bg-carbono/30 text-branco-cru' : 'bg-grafite-elevado text-nevoa')}>{count}</span>
    </button>
  );
}
