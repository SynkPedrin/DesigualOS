'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Bell, FileText, ImageIcon, Layers, RefreshCw, Settings2 } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaTrend } from '@/components/ui/area-trend';
import { ClientReportsPanel } from '@/components/clients/client-reports-panel';
import { useMediaAccounts, useMediaSettings, useMediaSummary, useSyncMediaAccount } from '@/hooks/use-media';
import { MEDIA_PERIODS, PROVIDER_LABEL, type MediaAccountSummary, type MediaLinkedAccount, type MediaPeriod } from '@/lib/api/media';
import { cn } from '@/lib/utils';
import { change, dash, int, money, pct, resultLabel, when } from './format';
import { CampaignsTab, CreativesTab } from './media-tables';
import { ActionsSection, AlertsTab, ReportSchedulesSection, SettingsTab } from './media-alerts-settings';

/**
 * MEDIA COMMAND CENTER de um cliente (Meta Ads).
 *
 * Lê do banco (sincronizado pelo worker), nunca do Meta ao vivo: a tela abre
 * rápido e uma conta com problema não derruba as outras. Cada número diz de
 * onde veio (conta, período, última sincronização) e o que "resultado" quer
 * dizer naquela conta. Nada é preenchido com zero quando o dado não existe.
 */

type Tab = 'overview' | 'campaigns' | 'creatives' | 'alerts' | 'reports' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Visão geral', icon: BarChart3 },
  { id: 'campaigns', label: 'Campanhas', icon: Layers },
  { id: 'creatives', label: 'Anúncios e criativos', icon: ImageIcon },
  { id: 'alerts', label: 'Alertas', icon: Bell },
  { id: 'reports', label: 'Relatórios', icon: FileText },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
];

const storageKey = (clientId: string) => `media:${clientId}`;

function readPref(clientId: string): { accountId?: string; period?: MediaPeriod; tab?: Tab } {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(clientId)) ?? '{}');
  } catch {
    return {};
  }
}

export function MediaCommandCenter({ clientId }: { clientId: string }) {
  const accounts = useMediaAccounts(clientId);
  const linked = useMemo(() => accounts.data?.linked ?? [], [accounts.data]);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [period, setPeriod] = useState<MediaPeriod | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  // Filtros persistentes por cliente (preferência de quem usa, só neste navegador).
  useEffect(() => {
    const p = readPref(clientId);
    if (p.accountId) setAccountId(p.accountId);
    if (p.period) setPeriod(p.period);
    if (p.tab) setTab(p.tab);
  }, [clientId]);

  const settings = useMediaSettings(clientId, accountId);
  const defaultPeriod = (settings.data?.values['dashboard.defaultPeriod'] as MediaPeriod | undefined) ?? 'last_30d';
  const effectivePeriod = period ?? defaultPeriod;
  const compare = (settings.data?.values['dashboard.compareWithPrevious'] as boolean | undefined) ?? true;

  const account = linked.find((a) => a.accountId === accountId) ?? linked.find((a) => a.isPrimary) ?? linked[0] ?? null;
  const activeId = account?.accountId ?? null;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(clientId), JSON.stringify({ accountId: activeId, period, tab }));
    } catch {
      /* sem storage, sem preferência — a tela segue igual */
    }
  }, [clientId, activeId, period, tab]);

  const sync = useSyncMediaAccount();

  if (accounts.isPending) return <Skeleton className="h-64 w-full" />;
  if (accounts.isError) {
    return (
      <Surface className="border-erro/40 bg-erro/5 p-5 text-sm text-erro">
        Não consegui carregar as contas de mídia deste cliente. Tente recarregar a página.
      </Surface>
    );
  }
  if (!account) {
    return (
      <Surface className="p-5 text-sm text-nevoa">
        Este cliente ainda não tem conta do Meta Ads vinculada. Vincule uma conta na ficha do cliente para ver campanhas, criativos e resultados aqui.
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      <InstanceGrid accounts={linked} unlinked={accounts.data?.unlinked ?? []} activeId={account.accountId} onPick={setAccountId} period={effectivePeriod} />

      <Surface className="flex flex-wrap items-center gap-3 p-3">
        <span className="inline-flex items-center gap-2 text-sm text-branco-cru">
          <PlatformBadge provider={account.provider} />
          <span className="font-medium">{account.name ?? account.label ?? account.accountId}</span>
        </span>
        <label className="flex items-center gap-2 text-xs text-nevoa">
          Período
          <select
            value={effectivePeriod}
            onChange={(e) => setPeriod(e.target.value as MediaPeriod)}
            className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru"
            aria-label="Período"
          >
            {MEDIA_PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <AccountHealth account={account} />
        <button
          type="button"
          onClick={() => sync.mutate(account.accountId)}
          disabled={sync.isPending}
          className="ml-auto inline-flex items-center gap-2 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa transition-colors hover:text-branco-cru disabled:opacity-40"
        >
          <RefreshCw size={14} className={sync.isPending ? 'animate-spin' : undefined} />
          {sync.isPending ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </Surface>
      {sync.isError && <p className="text-sm text-erro">Não consegui sincronizar agora. A conta continua com os dados da última sincronização.</p>}

      <nav className="flex flex-wrap gap-1 border-b border-grafite-elevado" role="tablist" aria-label="Seções de mídia">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
              tab === id ? 'border-roxo-eletrico text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview accountId={account.accountId} period={effectivePeriod} compare={compare} account={account} />}
      {tab === 'campaigns' && <CampaignsTab accountId={account.accountId} period={effectivePeriod} currency={account.currency} />}
      {tab === 'creatives' && <CreativesTab accountId={account.accountId} period={effectivePeriod} currency={account.currency} />}
      {tab === 'alerts' && (
        <div className="space-y-5">
          <AlertsTab clientId={clientId} accounts={linked} />
          <ActionsSection />
        </div>
      )}
      {tab === 'reports' && (
        <div className="space-y-4">
          <Surface className="p-5">
            <ClientReportsPanel clientId={clientId} />
          </Surface>
          <ReportSchedulesSection clientId={clientId} />
        </div>
      )}
      {tab === 'settings' && <SettingsTab clientId={clientId} accountId={account.accountId} />}
    </div>
  );
}

function AccountHealth({ account }: { account: MediaLinkedAccount }) {
  const problem = account.lastSyncError || (account.status && account.status !== 'ACTIVE');
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-nevoa">
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5', problem ? 'bg-erro/15 text-erro' : 'bg-sinal/15 text-sinal')}>
        {problem ? <AlertTriangle size={11} /> : <span className="size-1.5 rounded-full bg-sinal" />}
        {account.lastSyncError ? 'Falha na última sincronização' : account.status && account.status !== 'ACTIVE' ? `Conta ${account.status}` : 'Conexão saudável'}
      </span>
      <span>
        {account.currency ?? dash} · {account.timezone ?? dash} · sincronizada {when(account.lastSyncedAt)}
      </span>
    </div>
  );
}

function Kpi({ label, value, delta, invert = false, hint }: { label: string; value: string; delta?: number | null | undefined; invert?: boolean; hint?: string | undefined }) {
  const hasDelta = delta !== undefined;
  // Para custo (CPC, CPL), subir é ruim: a cor inverte.
  const good = delta === null || delta === undefined ? null : invert ? delta < 0 : delta > 0;
  return (
    <Surface className="p-4">
      <p className="text-xs text-nevoa">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tracking-tight text-branco-cru">{value}</p>
      {hasDelta && (
        <p className={cn('mt-1 text-xs', good === null ? 'text-nevoa' : good ? 'text-sinal' : 'text-erro')}>
          {change(delta)} <span className="text-nevoa">vs período anterior</span>
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-nevoa">{hint}</p>}
    </Surface>
  );
}

function Overview({ accountId, period, compare, account }: { accountId: string; period: MediaPeriod; compare: boolean; account: MediaLinkedAccount }) {
  const summary = useMediaSummary(accountId, period, compare);
  if (summary.isPending) return <Skeleton className="h-72 w-full" />;
  if (summary.isError || !summary.data) return <Surface className="p-5 text-sm text-erro">Não consegui carregar o resumo desta conta.</Surface>;
  const s: MediaAccountSummary = summary.data;
  const cur = s.current;
  const c = s.changes;
  const empty = cur.spend === null && cur.impressions === null;

  const spendSeries = s.daily.filter((d) => d.spend !== null).map((d) => ({ label: d.day.slice(5), value: d.spend as number }));
  const resultSeries = s.daily.filter((d) => d.results !== null).map((d) => ({ label: d.day.slice(5), value: d.results as number }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-nevoa">
        {s.range.since} a {s.range.until}
        {s.previousRange ? ` · comparando com ${s.previousRange.since} a ${s.previousRange.until}` : ''} · dados de {when(s.lastSyncedAt)}
        {s.partialToday ? ' · inclui hoje (dia ainda em andamento)' : ''}
      </p>
      {empty && <Surface className="p-5 text-sm text-nevoa">Sem dados no período para esta conta. Pode não ter havido veiculação, ou a primeira sincronização ainda não terminou.</Surface>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Investimento" value={money(cur.spend, s.currency)} delta={c?.spend} />
        <Kpi label="Impressões" value={int(cur.impressions)} delta={c?.impressions} />
        <Kpi label="Alcance" value={int(cur.reach)} delta={c?.reach} hint="Soma diária: não é alcance único do período" />
        <Kpi label="Cliques" value={int(cur.clicks)} delta={c?.clicks} />
        <Kpi label="CTR" value={pct(cur.ctr)} delta={c?.ctr} />
        <Kpi label="CPC" value={money(cur.cpc, s.currency)} delta={c?.cpc} invert />
        <Kpi label="CPM" value={money(cur.cpm, s.currency)} delta={c?.cpm} invert />
        <Kpi label={resultLabel(s.resultKinds)} value={int(cur.results)} delta={c?.results} hint={s.resultKinds.length === 0 ? 'Esta conta não rastreia resultados no período' : undefined} />
        <Kpi label="Custo por resultado" value={money(cur.costPerResult, s.currency)} delta={c?.costPerResult} invert />
        <Kpi label="ROAS" value={cur.roas === null ? dash : `${cur.roas.toFixed(2)}x`} delta={c?.roas} hint={cur.roas === null ? 'Sem valor de compra rastreado' : undefined} />
        <Kpi label="Campanhas ativas" value={`${s.campaigns.active} de ${s.campaigns.total}`} hint={`${s.campaigns.paused} pausadas`} />
        <Kpi label="Com problemas" value={String(s.campaigns.withIssues)} hint={s.campaigns.withIssues ? 'Reprovadas ou com pendência' : 'Nenhuma'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Surface className="p-4">
          <p className="mb-2 text-sm font-medium text-branco-cru">Investimento por dia</p>
          {spendSeries.length > 1 ? <AreaTrend data={spendSeries} formatValue={(v) => money(v, s.currency)} height={200} /> : <p className="py-10 text-center text-sm text-nevoa">Poucos dias com dado para desenhar a curva.</p>}
        </Surface>
        <Surface className="p-4">
          <p className="mb-2 text-sm font-medium text-branco-cru">{resultLabel(s.resultKinds)} por dia</p>
          {resultSeries.length > 1 ? <AreaTrend data={resultSeries} colorVar="--color-sinal" formatValue={(v) => int(v)} height={200} /> : <p className="py-10 text-center text-sm text-nevoa">Sem resultados rastreados nos dias do período.</p>}
        </Surface>
      </div>

      <Surface className="p-4 text-sm text-nevoa">
        <p className="font-medium text-branco-cru">Saldo e limite</p>
        <Balance account={account} />
      </Surface>
    </div>
  );
}

function Balance({ account }: { account: MediaLinkedAccount }) {
  if (account.balanceKind === 'ACTUAL_BALANCE') return <p className="mt-1">Saldo disponível: {money(account.balanceAmount, account.currency)}</p>;
  if (account.balanceKind === 'ESTIMATED_REMAINING')
    return (
      <p className="mt-1">
        Restante do limite de gastos (estimado): <span className="text-branco-cru">{money(account.balanceAmount, account.currency)}</span> de {money(account.spendCap, account.currency)}. Isto é o quanto falta para atingir o limite de gastos da conta, não o saldo pré-pago.
      </p>
    );
  return <p className="mt-1">Saldo indisponível: a conexão atual não lê o saldo desta conta e ela não tem limite de gastos definido. Alertas de saldo ficam inativos nesta conta.</p>;
}

function PlatformBadge({ provider }: { provider: 'meta' | 'google_ads' }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', provider === 'meta' ? 'bg-roxo-eletrico/20 text-roxo-eletrico' : 'bg-aviso/20 text-aviso')}>
      {PROVIDER_LABEL[provider]}
    </span>
  );
}

/**
 * AS INSTÂNCIAS DO CLIENTE: cada conta de anúncio (Meta ou Google) é um cartão
 * com saúde, última sincronização e gasto do período. Escolher o cartão abre o
 * painel de gerenciamento dessa conta logo abaixo. Conta sem cliente aparece
 * numa faixa à parte (só para quem pode vincular) e nunca é associada sozinha.
 */
function InstanceGrid({ accounts, unlinked, activeId, onPick, period }: { accounts: MediaLinkedAccount[]; unlinked: Array<{ accountId: string; name: string | null; provider: 'meta' | 'google_ads' }>; activeId: string; onPick: (id: string) => void; period: MediaPeriod }) {
  return (
    <section aria-label="Instâncias do cliente" className="space-y-2">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {accounts.map((a) => (
          <InstanceCard key={`${a.provider}:${a.accountId}`} account={a} active={a.accountId === activeId} onPick={() => onPick(a.accountId)} period={period} />
        ))}
      </div>
      {unlinked.length > 0 && (
        <details className="rounded-lg border border-grafite-elevado p-3">
          <summary className="cursor-pointer text-sm text-nevoa">{unlinked.length} conta(s) da agência ainda sem cliente</summary>
          <ul className="mt-2 space-y-1 text-sm text-nevoa">
            {unlinked.map((u) => (
              <li key={`${u.provider}:${u.accountId}`} className="flex items-center gap-2">
                <PlatformBadge provider={u.provider} /> {u.name ?? u.accountId} <span className="text-[11px]">({u.accountId})</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-nevoa">Vincule na ficha do cliente. O sistema não associa por nome parecido.</p>
        </details>
      )}
    </section>
  );
}

function InstanceCard({ account, active, onPick, period }: { account: MediaLinkedAccount; active: boolean; onPick: () => void; period: MediaPeriod }) {
  const summary = useMediaSummary(account.accountId, period, false);
  const problem = account.lastSyncError || (account.status && account.status !== 'ACTIVE');
  const cur = summary.data?.current;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn('rounded-lg border p-3 text-left transition-colors', active ? 'border-roxo-eletrico bg-roxo-eletrico/5' : 'border-grafite-elevado bg-grafite hover:border-nevoa')}
    >
      <div className="flex items-center justify-between gap-2">
        <PlatformBadge provider={account.provider} />
        <span className={cn('inline-flex items-center gap-1 text-[11px]', problem ? 'text-erro' : 'text-sinal')}>
          {problem ? <AlertTriangle size={11} /> : <span className="size-1.5 rounded-full bg-sinal" />}
          {account.lastSyncError ? 'sincronização falhou' : account.status && account.status !== 'ACTIVE' ? account.status : 'saudável'}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-branco-cru">{account.name ?? account.label ?? account.accountId}</p>
      <p className="truncate text-[11px] text-nevoa">{account.accountId}{account.isPrimary ? ' · principal' : ''}</p>
      <div className="mt-2 flex items-end justify-between gap-2 text-[11px] text-nevoa">
        <span>{summary.isPending ? '…' : cur?.spend != null ? `${money(cur.spend, account.currency)} no período` : 'sem dados no período'}</span>
        <span>{when(account.lastSyncedAt)}</span>
      </div>
      {account.lastSyncError && <p className="mt-1 line-clamp-2 text-[11px] text-erro">{account.lastSyncError}</p>}
    </button>
  );
}
