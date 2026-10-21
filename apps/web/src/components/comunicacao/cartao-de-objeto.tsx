'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Bot, Building2, CheckSquare, ClipboardList, ExternalLink, FileBarChart, Lock, Megaphone, RefreshCw, Siren } from 'lucide-react';
import { useAskAgent, useObjectState, type ChatObject, type ChatObjectType } from '@/hooks/use-internal-chat';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

/**
 * CARD DE ITEM COMPARTILHADO. Mostra o RESUMO DO ENVIO (o que quem mandou viu,
 * naquele momento) e, sob demanda, o ESTADO ATUAL — sempre com a permissão de
 * quem está lendo. Sem acesso ao item, o card diz isso e não mostra nada dele.
 */

const ROTULO: Record<ChatObjectType, string> = {
  task: 'Tarefa', client: 'Cliente', demand: 'Quinzena', media_account: 'Conta de anúncios', campaign: 'Campanha',
  adset: 'Conjunto de anúncios', ad: 'Anúncio', report: 'Relatório', media_alert: 'Alerta de mídia',
};

const ICONE: Record<ChatObjectType, typeof CheckSquare> = {
  task: CheckSquare, client: Building2, demand: ClipboardList, media_account: Megaphone, campaign: Megaphone,
  adset: Megaphone, ad: Megaphone, report: FileBarChart, media_alert: Siren,
};

const PERIODO: Record<string, string> = {
  today: 'Hoje', yesterday: 'Ontem', last_7d: 'Últimos 7 dias', last_14d: 'Últimos 14 dias', last_30d: 'Últimos 30 dias', this_month: 'Este mês', last_month: 'Mês passado',
};

const MIDIA = new Set<ChatObjectType>(['media_account', 'campaign', 'adset', 'ad', 'media_alert']);

function plataforma(p: unknown) {
  return p === 'meta' ? 'Meta Ads' : p === 'google_ads' ? 'Google Ads' : null;
}

function cabecalho(tipo: ChatObjectType, dados: Record<string, unknown> | null, provider: string | null) {
  if (tipo === 'task') return 'ClickUp · Tarefa';
  const p = plataforma(dados?.platform ?? provider);
  if (MIDIA.has(tipo) && tipo !== 'media_alert') return `${p ?? 'Mídia'} · ${ROTULO[tipo]}`;
  return ROTULO[tipo];
}

const s = (v: unknown) => (typeof v === 'string' ? v : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function dinheiro(v: number | null, moeda: string | null) {
  if (v === null) return '—';
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda || 'BRL' }).format(v); } catch { return v.toFixed(2); }
}
const inteiro = (v: number | null) => (v === null ? '—' : new Intl.NumberFormat('pt-BR').format(Math.round(v)));
const pct = (v: number | null) => (v === null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v)}%`);

function data(v: unknown) {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;
}

function nomeDe(dados: Record<string, unknown>) {
  return s(dados.name) ?? s(dados.title) ?? 'Item';
}

function linkDe(tipo: ChatObjectType, dados: Record<string, unknown>, objectId: string | null): { href: string; externo: boolean } | null {
  const cliente = (dados.client as { id?: string } | null | undefined)?.id;
  if (tipo === 'task') return s(dados.url) ? { href: s(dados.url)!, externo: true } : null;
  if (tipo === 'client' && objectId) return { href: `/clients/${objectId}`, externo: false };
  if (tipo === 'demand') return cliente ? { href: `/clients/${cliente}?aba=quinzenas`, externo: false } : { href: '/demands', externo: false };
  if (tipo === 'report') return cliente ? { href: `/clients/${cliente}?aba=relatorios`, externo: false } : null;
  if (MIDIA.has(tipo)) return cliente ? { href: `/midias/${cliente}`, externo: false } : { href: '/midias', externo: false };
  return null;
}

function Linhas({ tipo, dados }: { tipo: ChatObjectType; dados: Record<string, unknown> }) {
  const cliente = s((dados.client as { name?: string } | null | undefined)?.name);
  const itens: Array<[string, string | null]> = [];
  if (cliente && tipo !== 'client') itens.push(['Cliente', cliente]);
  if (tipo === 'task') {
    itens.push(['Status', s(dados.status)], ['Prioridade', s(dados.priority)], ['Responsável', Array.isArray(dados.assignees) && dados.assignees.length ? (dados.assignees as string[]).join(', ') : 'Sem responsável'], ['Prazo', data(dados.due_date)]);
  } else if (tipo === 'demand') {
    itens.push(['Status', s(dados.status)], ['Prioridade', s(dados.priority)], ['Prazo', data(dados.due_date)]);
  } else if (tipo === 'report') {
    itens.push(['Plataformas', Array.isArray(dados.channels) ? (dados.channels as string[]).map((c) => plataforma(c) ?? c).join(', ') : null], ['Período', `${data(dados.period_start) ?? '?'} a ${data(dados.period_end) ?? '?'}`], ['Status', s(dados.status) === 'ready' ? 'Pronto' : s(dados.status)], ['Autor', s(dados.author)], ['Gerado em', data(dados.created_at)]);
  } else if (tipo === 'media_alert') {
    itens.push(['Gravidade', s(dados.severity)], ['Situação', s(dados.status)], ['Disparado em', data(dados.fired_at)]);
  } else if (MIDIA.has(tipo)) {
    if (s(dados.status)) itens.push(['Status', s(dados.status)]);
    if (tipo !== 'media_account' && dados.account) itens.push(['Conta', s((dados.account as { name?: string }).name)]);
  }
  const visiveis = itens.filter(([, v]) => v);
  if (visiveis.length === 0) return null;
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {visiveis.map(([k, v]) => (<Fragment key={k}><dt className="text-nevoa">{k}</dt><dd className="truncate text-branco-cru">{v}</dd></Fragment>))}
    </dl>
  );
}

function Metricas({ dados }: { dados: Record<string, unknown> }) {
  const m = dados.metrics as Record<string, unknown> | null | undefined;
  if (!m) return <p className="mt-1.5 text-xs text-nevoa">Sem métricas sincronizadas para o período.</p>;
  const moeda = s(dados.currency);
  const tipos = Array.isArray(dados.result_kinds) ? (dados.result_kinds as string[]) : [];
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ['Investimento', dinheiro(n(m.spend), moeda)],
          [tipos.length === 1 ? `Resultados (${tipos[0]})` : 'Resultados', inteiro(n(m.results))],
          ['Custo/resultado', dinheiro(n(m.cost_per_result), moeda)],
          ['CTR', pct(n(m.ctr))],
        ] as const).map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-md bg-carbono/30 px-2 py-1.5">
            <p className="truncate text-[10px] uppercase tracking-wide text-nevoa">{rotulo}</p>
            <p className="font-mono text-[13px] text-branco-cru">{valor}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 font-mono text-[10px] text-nevoa">
        {PERIODO[s(dados.period) ?? ''] ?? s(dados.period) ?? 'Período'}{dados.range ? ` (${data((dados.range as { since?: string }).since)} a ${data((dados.range as { until?: string }).until)})` : ''} · {moeda ?? 'moeda da conta'} · {plataforma(dados.platform) ?? ''}
      </p>
    </div>
  );
}

export function CartaoDeObjeto({ objeto }: { objeto: ChatObject }) {
  const router = useRouter();
  const [verAtual, setVerAtual] = useState(false);
  // Evento ao vivo chega sem resumo: busca o estado atual direto (com a permissão de quem lê).
  const precisaBuscar = verAtual || (objeto.snapshot === null && !objeto.restricted);
  const atual = useObjectState(objeto.id, precisaBuscar);
  const agente = useAskAgent();
  const tipo = objeto.type;
  const Icone = ICONE[tipo] ?? BarChart3;

  const semAcesso = objeto.restricted || (atual.data && atual.data.state === 'sem_acesso');
  if (semAcesso) {
    return (
      <div className="mt-1.5 flex w-full max-w-md items-center gap-2 rounded-lg border border-dashed border-grafite-elevado px-3 py-2 text-xs text-nevoa">
        <Lock size={14} /> {ROTULO[tipo] ?? 'Item'} compartilhado. Você não tem acesso a ele.
      </div>
    );
  }
  const estadoAtual = atual.data?.state === 'ok' ? atual.data : null;
  const problema = atual.data && atual.data.state !== 'ok' ? atual.data.message : null;
  const dados = (verAtual && estadoAtual ? estadoAtual.data : objeto.snapshot) ?? estadoAtual?.data ?? null;
  const link = dados ? linkDe(tipo, dados, estadoAtual?.object_id ?? objeto.object_id) : null;
  const ehMidia = MIDIA.has(tipo) && tipo !== 'media_alert';

  async function pedirAgente() {
    try {
      const r = await agente.mutateAsync({ action: 'analyze_object', object_id: objeto.id });
      router.push(`/chat?conversation=${r.conversation_id}&agent=${r.agent}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'O agente não está disponível agora.', 'error');
    }
  }

  return (
    <div className="mt-1.5 w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5" data-testid="cartao-de-objeto">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-nevoa">
        <Icone size={12} /> {cabecalho(tipo, dados, objeto.provider)}
        {ehMidia && dados && <span className="ml-auto normal-case tracking-normal">{verAtual && estadoAtual ? 'agora' : 'no envio'}</span>}
      </p>
      {dados ? (
        <>
          <p className="mt-1 text-sm font-semibold text-branco-cru">{nomeDe(dados)}</p>
          {tipo === 'media_alert' && s(dados.detail) && <p className="text-xs text-nevoa">{s(dados.detail)}</p>}
          <Linhas tipo={tipo} dados={dados} />
          {ehMidia && <Metricas dados={dados} />}
          {verAtual && estadoAtual && <p className="mt-1 font-mono text-[10px] text-nevoa">Atualizado às {new Date(estadoAtual.fetched_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}
        </>
      ) : atual.isPending ? (
        <p className="mt-1 text-xs text-nevoa">Carregando…</p>
      ) : (
        <p className="mt-1 text-xs text-nevoa">{problema ?? 'Item indisponível.'}</p>
      )}
      {problema && verAtual && <p className="mt-1 text-xs text-aviso">{problema}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {link && (
          link.externo
            ? <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-grafite-elevado px-2 py-1 text-[11px] text-branco-cru hover:bg-grafite-elevado/70"><ExternalLink size={11} /> Abrir</a>
            : <button type="button" onClick={() => router.push(link.href)} className="inline-flex items-center gap-1 rounded-md bg-grafite-elevado px-2 py-1 text-[11px] text-branco-cru hover:bg-grafite-elevado/70"><ExternalLink size={11} /> Abrir</button>
        )}
        {!objeto.id.startsWith('local-') && (
          <button type="button" onClick={() => { setVerAtual(true); if (verAtual) void atual.refetch(); }} className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-grafite-elevado', verAtual ? 'text-branco-cru' : 'text-nevoa')}>
            <RefreshCw size={11} className={cn(atual.isFetching && 'animate-spin')} /> {ehMidia ? 'Ver atual' : 'Ver detalhes'}
          </button>
        )}
        {!objeto.id.startsWith('local-') && (tipo !== 'client') && (
          <button type="button" disabled={agente.isPending} onClick={() => void pedirAgente()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-roxo-eletrico hover:bg-roxo-eletrico/10 disabled:opacity-50">
            <Bot size={11} /> {MIDIA.has(tipo) ? 'Analisar com Jarbas' : tipo === 'task' ? 'Resumir com Bento' : 'Perguntar ao Bento'}
          </button>
        )}
      </div>
    </div>
  );
}
