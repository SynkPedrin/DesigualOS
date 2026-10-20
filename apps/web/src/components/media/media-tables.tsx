'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Download, Eye, ImageOff, LayoutGrid, Rows3, X } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useMediaCreatives, useMediaEntities } from '@/hooks/use-media';
import type { MediaCreativeRow, MediaEntityRow, MediaPeriod } from '@/lib/api/media';
import { cn } from '@/lib/utils';
import { dash, int, money, pct, STATUS_LABEL, TONE_CLASS } from './format';

type Level = 'campaign' | 'adset' | 'ad';
const LEVEL_LABEL: Record<Level, string> = { campaign: 'Campanhas', adset: 'Conjuntos', ad: 'Anúncios' };
const NEXT: Record<Level, Level | null> = { campaign: 'adset', adset: 'ad', ad: null };

type ColumnKey = 'status' | 'budget' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm' | 'results' | 'costPerResult' | 'roas';
const COLUMNS: Array<{ key: ColumnKey; label: string; sortable: boolean }> = [
  { key: 'status', label: 'Status', sortable: false },
  { key: 'budget', label: 'Orçamento', sortable: false },
  { key: 'spend', label: 'Investimento', sortable: true },
  { key: 'impressions', label: 'Impressões', sortable: true },
  { key: 'clicks', label: 'Cliques', sortable: true },
  { key: 'ctr', label: 'CTR', sortable: true },
  { key: 'cpc', label: 'CPC', sortable: true },
  { key: 'cpm', label: 'CPM', sortable: false },
  { key: 'results', label: 'Resultados', sortable: true },
  { key: 'costPerResult', label: 'Custo/resultado', sortable: true },
  { key: 'roas', label: 'ROAS', sortable: false },
];
const DEFAULT_COLUMNS: ColumnKey[] = ['status', 'budget', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'results', 'costPerResult'];

export function StatusChip({ status }: { status: string | null }) {
  const meta = (status && STATUS_LABEL[status]) || { text: status ?? dash, tone: 'mute' as const };
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px]', TONE_CLASS[meta.tone])}>{meta.text}</span>;
}

function cell(row: MediaEntityRow, key: ColumnKey, currency: string | null): string {
  switch (key) {
    case 'budget':
      return row.dailyBudget !== null ? `${money(row.dailyBudget, currency)}/dia` : row.lifetimeBudget !== null ? `${money(row.lifetimeBudget, currency)} total` : dash;
    case 'spend':
    case 'cpc':
    case 'cpm':
    case 'costPerResult':
      return money(row[key], currency);
    case 'ctr':
      return pct(row.ctr);
    case 'roas':
      return row.roas === null ? dash : `${row.roas.toFixed(2)}x`;
    case 'status':
      return '';
    default:
      return int(row[key]);
  }
}

/** Exporta o que está na tela, com os mesmos filtros e ordem. CSV com BOM para o Excel abrir acentos. */
function exportCsv(name: string, rows: MediaEntityRow[], currency: string | null) {
  const head = ['Nome', 'Status', 'Orçamento diário', 'Investimento', 'Impressões', 'Cliques', 'CTR (%)', 'CPC', 'CPM', 'Resultados', 'Custo por resultado', 'ROAS', `Moeda`];
  const lines = rows.map((r) => [r.name, r.effectiveStatus ?? r.status ?? '', r.dailyBudget ?? '', r.spend ?? '', r.impressions ?? '', r.clicks ?? '', r.ctr ?? '', r.cpc ?? '', r.cpm ?? '', r.results ?? '', r.costPerResult ?? '', r.roas ?? '', currency ?? '']);
  const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CampaignsTab({ accountId, period, currency }: { accountId: string; period: MediaPeriod; currency: string | null }) {
  // Trilha de navegação: campanha > conjunto > anúncio. Cada passo guarda quem é o pai.
  const [trail, setTrail] = useState<Array<{ level: Level; id: string; name: string }>>([]);
  const level: Level = trail.length === 0 ? 'campaign' : trail.length === 1 ? 'adset' : 'ad';
  const parentId = trail.at(-1)?.id ?? null;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('spend');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [picking, setPicking] = useState(false);

  const q = useMediaEntities(accountId, period, { level, parentId, search, status, sort, dir });
  const rows = q.data?.rows ?? [];
  const totals = useMemo(() => {
    const sum = (k: 'spend' | 'impressions' | 'clicks' | 'results') => {
      const vals = rows.map((r) => r[k]).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    return { spend: sum('spend'), impressions: sum('impressions'), clicks: sum('clicks'), results: sum('results') };
  }, [rows]);

  const toggleSort = (key: string) => {
    if (sort === key) setDir(dir === 'desc' ? 'asc' : 'desc');
    else {
      setSort(key);
      setDir('desc');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1 text-sm" aria-label="Navegação hierárquica">
          <button type="button" onClick={() => setTrail([])} className={cn('rounded px-2 py-1', trail.length === 0 ? 'text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
            Campanhas
          </button>
          {trail.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-nevoa" />
              <button type="button" onClick={() => setTrail(trail.slice(0, i + 1))} className={cn('max-w-[220px] truncate rounded px-2 py-1', i === trail.length - 1 ? 'text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
                {t.name}
              </button>
            </span>
          ))}
          <span className="ml-1 text-xs text-nevoa">· {LEVEL_LABEL[level]}</span>
        </nav>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome"
          aria-label="Buscar por nome"
          className="ml-auto w-48 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru placeholder:text-nevoa"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status" className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">
          <option value="">Todos os status</option>
          <option value="ACTIVE">Ativas</option>
          <option value="PAUSED">Pausadas</option>
          <option value="DISAPPROVED">Reprovadas</option>
          <option value="WITH_ISSUES">Com problemas</option>
        </select>
        <div className="relative">
          <button type="button" onClick={() => setPicking(!picking)} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru">
            Colunas
          </button>
          {picking && (
            <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-grafite-elevado bg-grafite p-2 shadow-elevated">
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-sm text-nevoa">
                  <input type="checkbox" checked={columns.includes(c.key)} onChange={() => setColumns(columns.includes(c.key) ? columns.filter((k) => k !== c.key) : COLUMNS.map((x) => x.key).filter((k) => k === c.key || columns.includes(k)))} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => exportCsv(`midia-${level}-${period}`, rows, currency)} disabled={rows.length === 0} className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru disabled:opacity-40">
          <Download size={13} /> Exportar CSV
        </button>
      </div>

      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <Surface className="p-5 text-sm text-erro">Não consegui carregar esta tabela.</Surface>
      ) : rows.length === 0 ? (
        <Surface className="p-5 text-sm text-nevoa">Nada encontrado com estes filtros. Se a conta é nova, a primeira sincronização pode ainda não ter terminado.</Surface>
      ) : (
        <Surface className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-grafite-elevado text-left text-xs text-nevoa">
                <th scope="col" className="sticky left-0 bg-grafite px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-branco-cru">
                    Nome {sort === 'name' && (dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </button>
                </th>
                {COLUMNS.filter((c) => columns.includes(c.key)).map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {c.sortable ? (
                      <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-branco-cru">
                        {c.label} {sort === c.key && (dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const next = NEXT[level];
                return (
                  <tr key={r.id} className="border-b border-grafite-elevado/50 hover:bg-grafite-elevado/30">
                    <td className="sticky left-0 max-w-[320px] bg-grafite px-3 py-2">
                      {next ? (
                        <button type="button" onClick={() => setTrail([...trail, { level, id: r.id, name: r.name }])} className="flex max-w-full items-center gap-1 truncate text-left text-branco-cru hover:text-roxo-eletrico">
                          <span className="truncate">{r.name}</span>
                          <ChevronRight size={12} className="shrink-0" />
                        </button>
                      ) : (
                        <span className="block truncate text-branco-cru">{r.name}</span>
                      )}
                    </td>
                    {COLUMNS.filter((c) => columns.includes(c.key)).map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right tabular-nums text-nevoa">
                        {c.key === 'status' ? <StatusChip status={r.effectiveStatus ?? r.status} /> : cell(r, c.key, currency)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-xs text-nevoa">
                <td className="sticky left-0 bg-grafite px-3 py-2">Total ({rows.length})</td>
                {COLUMNS.filter((c) => columns.includes(c.key)).map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                    {c.key === 'spend' ? money(totals.spend, currency) : c.key === 'impressions' ? int(totals.impressions) : c.key === 'clicks' ? int(totals.clicks) : c.key === 'results' ? int(totals.results) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </Surface>
      )}
    </div>
  );
}

// ── Criativos ────────────────────────────────────────────────────────────

type ViewMode = 'gallery' | 'table';
type Filter = 'all' | 'best' | 'worst' | 'active';

export function CreativesTab({ accountId, period, currency }: { accountId: string; period: MediaPeriod; currency: string | null }) {
  const [mode, setMode] = useState<ViewMode>('gallery');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState('spend');
  const [open, setOpen] = useState<MediaCreativeRow | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const q = useMediaCreatives(accountId, period, sort, 'desc');

  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    if (filter === 'active') return all.filter((r) => r.effectiveStatus === 'ACTIVE');
    // "Melhor"/"pior" só entre anúncios com custo por resultado medido e gasto relevante: sem resultado não há ranking honesto.
    const ranked = all.filter((r) => r.costPerResult !== null && (r.spend ?? 0) > 0);
    if (filter === 'best') return [...ranked].sort((a, b) => (a.costPerResult as number) - (b.costPerResult as number)).slice(0, 12);
    if (filter === 'worst') return [...ranked].sort((a, b) => (b.costPerResult as number) - (a.costPerResult as number)).slice(0, 12);
    return all;
  }, [q.data, filter]);

  const toCompare = rows.filter((r) => compare.includes(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-grafite-elevado p-0.5" role="group" aria-label="Modo de visualização">
          {([['gallery', LayoutGrid, 'Galeria'], ['table', Rows3, 'Tabela']] as const).map(([m, Icon, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm', mode === m ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtro" className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">
          <option value="all">Todos</option>
          <option value="active">Só ativos</option>
          <option value="best">Melhores (menor custo por resultado)</option>
          <option value="worst">Piores (maior custo por resultado)</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar por" className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">
          <option value="spend">Investimento</option>
          <option value="results">Resultados</option>
          <option value="ctr">CTR</option>
          <option value="clicks">Cliques</option>
          <option value="impressions">Impressões</option>
        </select>
        {compare.length > 0 && <span className="text-xs text-nevoa">{compare.length} selecionado(s) para comparar</span>}
      </div>

      {q.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : q.isError ? (
        <Surface className="p-5 text-sm text-erro">Não consegui carregar os anúncios.</Surface>
      ) : rows.length === 0 ? (
        <Surface className="p-5 text-sm text-nevoa">Nenhum anúncio para este filtro e período.</Surface>
      ) : mode === 'gallery' ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {rows.map((r) => (
            <CreativeCard key={r.id} row={r} currency={currency} selected={compare.includes(r.id)} onToggle={() => setCompare(compare.includes(r.id) ? compare.filter((x) => x !== r.id) : [...compare, r.id].slice(-4))} onOpen={() => setOpen(r)} />
          ))}
        </div>
      ) : (
        <Surface className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-grafite-elevado text-left text-xs text-nevoa">
                <th className="px-3 py-2 font-medium">Anúncio</th>
                <th className="px-3 py-2 font-medium">Campanha</th>
                <th className="px-3 py-2 text-right font-medium">Investimento</th>
                <th className="px-3 py-2 text-right font-medium">CTR</th>
                <th className="px-3 py-2 text-right font-medium">Resultados</th>
                <th className="px-3 py-2 text-right font-medium">Custo/resultado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-grafite-elevado/50 hover:bg-grafite-elevado/30" onClick={() => setOpen(r)}>
                  <td className="max-w-[300px] truncate px-3 py-2 text-branco-cru">{r.name}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-nevoa">{r.campaignName ?? dash}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-nevoa">{money(r.spend, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-nevoa">{pct(r.ctr)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-nevoa">{int(r.results)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-nevoa">{money(r.costPerResult, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}

      {toCompare.length >= 2 && (
        <Surface className="overflow-x-auto p-4">
          <p className="mb-2 text-sm font-medium text-branco-cru">Comparação</p>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-nevoa">
                <th className="py-1 font-medium" />
                {toCompare.map((r) => (
                  <th key={r.id} className="max-w-[160px] truncate px-2 py-1 font-medium text-branco-cru">{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-nevoa">
              {([['Investimento', (r: MediaCreativeRow) => money(r.spend, currency)], ['Impressões', (r: MediaCreativeRow) => int(r.impressions)], ['CTR', (r: MediaCreativeRow) => pct(r.ctr)], ['CPC', (r: MediaCreativeRow) => money(r.cpc, currency)], ['Resultados', (r: MediaCreativeRow) => int(r.results)], ['Custo/resultado', (r: MediaCreativeRow) => money(r.costPerResult, currency)]] as const).map(([label, fn]) => (
                <tr key={label} className="border-t border-grafite-elevado/50">
                  <td className="py-1 text-xs">{label}</td>
                  {toCompare.map((r) => (
                    <td key={r.id} className="px-2 py-1 tabular-nums">{fn(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}

      {open && <CreativeDrawer row={open} currency={currency} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Thumb({ row, className }: { row: MediaCreativeRow; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = row.creative?.imageUrl ?? row.creative?.thumbnailUrl ?? null;
  // A URL do Meta é assinada e EXPIRA em horas. Quando falha, diz "indisponível" em vez de ficar um quadrado quebrado.
  if (!src || failed) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 bg-carbono text-nevoa', className)}>
        <ImageOff size={20} />
        <span className="px-2 text-center text-[11px]">Prévia indisponível</span>
      </div>
    );
  }
  return <img src={src} alt={row.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn('object-cover', className)} />;
}

function CreativeCard({ row, currency, selected, onToggle, onOpen }: { row: MediaCreativeRow; currency: string | null; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <Surface className={cn('flex flex-col overflow-hidden', selected && 'ring-2 ring-roxo-eletrico')}>
      <button type="button" onClick={onOpen} className="block text-left" aria-label={`Abrir ${row.name}`}>
        <Thumb row={row} className="aspect-square w-full" />
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm text-branco-cru">{row.name}</p>
          <StatusChip status={row.effectiveStatus ?? row.status} />
        </div>
        <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-nevoa">
          <dt>Invest.</dt><dd className="text-right tabular-nums text-branco-cru">{money(row.spend, currency)}</dd>
          <dt>CTR</dt><dd className="text-right tabular-nums text-branco-cru">{pct(row.ctr)}</dd>
          <dt>Result.</dt><dd className="text-right tabular-nums text-branco-cru">{int(row.results)}</dd>
          <dt>Custo/res.</dt><dd className="text-right tabular-nums text-branco-cru">{money(row.costPerResult, currency)}</dd>
        </dl>
        <label className="mt-auto flex items-center gap-2 pt-2 text-[11px] text-nevoa">
          <input type="checkbox" checked={selected} onChange={onToggle} /> Comparar
        </label>
      </div>
    </Surface>
  );
}

function CreativeDrawer({ row, currency, onClose }: { row: MediaCreativeRow; currency: string | null; onClose: () => void }) {
  const [note, setNote] = useState(() => {
    try {
      return window.localStorage.getItem(`media:note:${row.id}`) ?? '';
    } catch {
      return '';
    }
  });
  const c = row.creative;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`Detalhes de ${row.name}`} onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-grafite-elevado bg-grafite p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="font-heading text-base font-semibold text-branco-cru">{row.name}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru"><X size={16} /></button>
        </div>
        <Thumb row={row} className="mb-3 aspect-square w-full rounded-md" />
        <div className="space-y-1 text-sm text-nevoa">
          <p><span className="text-branco-cru">Campanha:</span> {row.campaignName ?? dash}</p>
          <p><span className="text-branco-cru">Conjunto:</span> {row.adsetName ?? dash}</p>
          {c?.title && <p><span className="text-branco-cru">Título:</span> {c.title}</p>}
          {c?.body && <p className="whitespace-pre-line"><span className="text-branco-cru">Texto:</span> {c.body}</p>}
          {c?.callToAction && <p><span className="text-branco-cru">CTA:</span> {c.callToAction}</p>}
          {c?.linkUrl && (
            <p className="break-all"><span className="text-branco-cru">Destino:</span> <a href={c.linkUrl} target="_blank" rel="noreferrer noopener" className="text-roxo-eletrico hover:underline">{c.linkUrl}</a></p>
          )}
          {c?.videoId && <p className="flex items-center gap-1"><Eye size={12} /> Anúncio em vídeo (o vídeo em si não é copiado para cá).</p>}
          {!c && <p>Este anúncio não trouxe dados de criativo.</p>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {([['Investimento', money(row.spend, currency)], ['Impressões', int(row.impressions)], ['Cliques', int(row.clicks)], ['CTR', pct(row.ctr)], ['CPC', money(row.cpc, currency)], ['Resultados', int(row.results)], ['Custo/resultado', money(row.costPerResult, currency)], ['ROAS', row.roas === null ? dash : `${row.roas.toFixed(2)}x`]] as const).map(([k, v]) => (
            <div key={k} className="rounded-md bg-carbono p-2"><dt className="text-[11px] text-nevoa">{k}</dt><dd className="tabular-nums text-branco-cru">{v}</dd></div>
          ))}
        </dl>
        <label className="mt-4 block text-xs text-nevoa">
          Nota interna (fica só neste navegador)
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              try {
                window.localStorage.setItem(`media:note:${row.id}`, e.target.value);
              } catch {
                /* sem storage */
              }
            }}
            rows={3}
            className="mt-1 w-full rounded-md border border-grafite-elevado bg-carbono p-2 text-sm text-branco-cru"
          />
        </label>
      </aside>
    </div>
  );
}
