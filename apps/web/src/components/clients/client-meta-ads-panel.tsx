'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { Link2, Loader2, Unlink } from 'lucide-react';
import { useMetaIntegration, useConnectMeta, useMetaBusinesses, useMetaAdAccounts } from '@/hooks/use-meta-integration';
import { useClientMetaCreatives, useClientMetaAccounts, useLinkClientMetaAccount, useUnlinkClientMetaAccount, useClientMetaSummary } from '@/hooks/use-client-meta-accounts';
import { ApiRequestError } from '@/lib/api/client';

/**
 * Cliente → Mídia → Meta Ads (§34-42 do prompt de refinamento, 06/10/2026).
 * REGRA FUNDAMENTAL do prompt: mídia é sempre vinculada a ESTE cliente — o
 * backend garante o isolamento (clients/routes.ts + meta-accounts.test.ts),
 * esta tela só nunca manda um clientId que não seja o seu.
 *
 * Três estados possíveis, nesta ordem:
 *   1. quem está olhando não tem o Meta conectado -> "Conectar Meta Ads";
 *   2. conectado, mas este cliente não tem conta vinculada -> seletor BM → Ad Account;
 *   3. vinculado -> resumo de performance (ou aviso de reconexão, nunca número inventado).
 */
function formatCurrency(value: number | null, currency = 'BRL'): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR').format(Math.round(value));
}

function MetaLogo() {
  return <Image src="/logos/meta.png" alt="" width={20} height={20} className="rounded-sm" />;
}

function ConnectPrompt() {
  const connect = useConnectMeta();
  const integration = useMetaIntegration();
  return (
    <div className="rounded-lg border border-grafite-elevado p-4">
      <div className="mb-2 flex items-center gap-2">
        <MetaLogo />
        <p className="text-sm font-semibold text-branco-cru">Meta Ads</p>
      </div>
      <p className="mb-3 text-xs text-nevoa">
        Conecte sua conta Meta for Business pra vincular o Business Manager e a Ad Account deste cliente. A conexão é
        sua — outros clientes usam o mesmo login sem misturar dados entre si.
      </p>
      <button
        type="button"
        onClick={() => connect.mutate()}
        disabled={connect.isPending || integration.data?.configured === false}
        className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50"
      >
        <Link2 size={14} />
        {connect.isPending ? 'Abrindo o Meta…' : 'Conectar Meta Ads'}
      </button>
      {integration.data?.configured === false && (
        <p className="mt-2 text-[11px] text-erro">O servidor ainda não tem as credenciais OAuth do Meta configuradas.</p>
      )}
      {connect.isError && <p className="mt-2 text-[11px] text-erro">Não foi possível iniciar a conexão.</p>}
    </div>
  );
}

function LinkAccountPicker({ clientId }: { clientId: string }) {
  const [businessId, setBusinessId] = useState<string>('');
  const businesses = useMetaBusinesses(true);
  const adAccounts = useMetaAdAccounts(businessId || null, Boolean(businessId));
  const link = useLinkClientMetaAccount(clientId);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const accounts = adAccounts.data?.ad_accounts ?? [];

  return (
    <div className="rounded-lg border border-grafite-elevado p-4">
      <div className="mb-2 flex items-center gap-2">
        <MetaLogo />
        <p className="text-sm font-semibold text-branco-cru">Meta Ads conectado — vincule a conta deste cliente</p>
      </div>

      {businesses.isPending ? (
        <p className="flex items-center gap-2 py-4 text-sm text-nevoa">
          <Loader2 size={14} className="animate-spin" /> Buscando Business Managers…
        </p>
      ) : businesses.isError ? (
        <p className="py-2 text-xs text-erro">
          {businesses.error instanceof ApiRequestError ? businesses.error.message : 'Não foi possível listar os Business Managers.'}
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Business Manager</label>
            <select
              value={businessId}
              onChange={(event) => {
                setBusinessId(event.target.value);
                setSelectedAccountId('');
              }}
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
            >
              <option value="">Selecione…</option>
              {(businesses.data?.businesses ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {businessId && (
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Ad Account</label>
              {adAccounts.isPending ? (
                <p className="flex items-center gap-2 py-2 text-xs text-nevoa">
                  <Loader2 size={12} className="animate-spin" /> Buscando contas…
                </p>
              ) : (
                <select
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
                >
                  <option value="">Selecione…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.id} ({a.currency ?? '—'})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={!selectedAccountId || link.isPending}
            onClick={() => {
              const account = accounts.find((a) => a.id === selectedAccountId);
              link.mutate({ account_id: selectedAccountId, business_id: businessId, label: account?.name ?? undefined, is_primary: true });
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40"
          >
            {link.isPending ? 'Vinculando…' : 'Vincular a este cliente'}
          </button>
          {link.isError && (
            <p className="text-[11px] text-erro">{link.error instanceof ApiRequestError ? link.error.message : 'Não foi possível vincular a conta.'}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedSummary({ clientId, accountId, businessId, label }: { clientId: string; accountId: string; businessId: string | null; label: string | null }) {
  const summary = useClientMetaSummary(clientId, true);
  const unlink = useUnlinkClientMetaAccount(clientId);

  const insights = summary.data && summary.data.connected && summary.data.data_available ? summary.data.insights : null;
  const campaigns = summary.data && summary.data.connected && summary.data.data_available ? summary.data.campaigns : [];
  const reason = summary.data && summary.data.connected && !summary.data.data_available ? summary.data.reason : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-grafite-elevado p-4">
        <div className="flex items-center gap-2">
          <MetaLogo />
          <div>
            <p className="text-sm font-semibold text-branco-cru">{label ?? accountId}</p>
            <p className="font-mono text-[11px] text-nevoa">
              {accountId}
              {businessId ? ` · BM ${businessId}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => unlink.mutate(accountId)}
          disabled={unlink.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa transition-colors hover:border-erro/50 hover:text-erro disabled:opacity-50"
        >
          <Unlink size={12} /> Desvincular
        </button>
      </div>

      {summary.isPending ? (
        <p className="flex items-center gap-2 py-4 text-sm text-nevoa">
          <Loader2 size={14} className="animate-spin" /> Buscando dados no Meta…
        </p>
      ) : reason ? (
        <p className="rounded-md bg-aviso/10 px-3 py-2 text-xs text-aviso">{reason}</p>
      ) : summary.isError ? (
        <p className="rounded-md bg-erro/10 px-3 py-2 text-xs text-erro">
          {summary.error instanceof ApiRequestError ? summary.error.message : 'Não foi possível buscar os dados de mídia.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Investimento (30d)', formatCurrency(insights?.spend ?? null)],
              ['Resultados', formatNumber(insights?.results ?? null)],
              ['CTR', insights?.ctr != null ? `${insights.ctr.toFixed(2)}%` : '—'],
              ['CPM', formatCurrency(insights?.cpm ?? null)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-grafite-elevado p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{k}</p>
                <p className="mt-1 text-lg font-semibold text-branco-cru">{v}</p>
              </div>
            ))}
          </div>

          {campaigns.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-grafite-elevado">
              <table className="w-full text-sm">
                <thead className="bg-grafite-elevado/50 text-left font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  <tr>
                    <th className="px-3 py-2">Campanha</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Spend</th>
                    <th className="px-3 py-2 text-right">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-t border-grafite-elevado">
                      <td className="px-3 py-2 text-branco-cru">{c.name}</td>
                      <td className="px-3 py-2 text-nevoa">{c.status}</td>
                      <td className="px-3 py-2 text-right text-branco-cru">{formatCurrency(c.spend)}</td>
                      <td className="px-3 py-2 text-right text-nevoa">{c.ctr != null ? `${c.ctr.toFixed(2)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <GaleriaDeCriativos clientId={clientId} />
        </>
      )}
    </div>
  );
}

/**
 * AS PEÇAS QUE ESTÃO RODANDO.
 *
 * Número de campanha responde "quanto"; o criativo responde "o quê" — e é o
 * "o quê" que o time de criação usa pra decidir o que repetir. Esta galeria é
 * a primeira vez que o produto mostra a peça, não só a linha da planilha.
 *
 * A consulta é SEPARADA da do resumo de propósito: ela custa uma ida a mais à
 * Graph API, e quem abriu a ficha pra ver quanto gastou não deveria pagar por
 * ela. Falhar aqui não derruba o resumo — a seção some.
 */
function GaleriaDeCriativos({ clientId }: { clientId: string }) {
  const criativos = useClientMetaCreatives(clientId, true);

  if (criativos.isPending || criativos.isError) return null;
  const dados = criativos.data;
  if (!dados?.connected || !dados.data_available || dados.creatives.length === 0) return null;

  // Sem imagem não é peça pra mostrar: anúncio de texto puro entra na tabela
  // de campanhas, não numa galeria visual.
  const comImagem = dados.creatives.filter((c) => c.thumbnail_url || c.image_url);
  if (comImagem.length === 0) return null;

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">
        Criativos no ar ({comImagem.length})
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {comImagem.map((c) => (
          <figure key={c.id} className="overflow-hidden rounded-lg border border-grafite-elevado bg-carbono">
            {/* `img` cru, não next/image: estas URLs são assinadas pelo Meta,
              * expiram em horas e mudam a cada leitura — otimizar e cachear
              * uma URL efêmera só produz imagem quebrada mais tarde. */}
            <img
              src={(c.thumbnail_url ?? c.image_url)!}
              alt={c.name}
              loading="lazy"
              className="h-28 w-full bg-grafite object-cover"
            />
            <figcaption className="px-2.5 py-2">
              <p className="truncate text-[12px] text-branco-cru" title={c.name}>
                {c.name}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-nevoa">
                {formatCurrency(c.spend)} · CTR {c.ctr != null ? `${c.ctr.toFixed(2)}%` : '—'}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function ClientMetaAdsPanel({ clientId }: { clientId: string }) {
  const integration = useMetaIntegration();
  const accounts = useClientMetaAccounts(clientId);

  const primary = useMemo(() => accounts.data?.find((a) => a.is_primary) ?? accounts.data?.[0] ?? null, [accounts.data]);

  // 403 = o workspace builder desta pessoa não inclui "meta_ads" — o painel
  // some, igual a um item de navegação escondido por módulo (nunca mensagem
  // de erro pra algo que é esperado).
  if (accounts.error instanceof ApiRequestError && accounts.error.status === 403) return null;

  if (integration.isPending || accounts.isPending) {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-nevoa">
        <Loader2 size={15} className="animate-spin" /> Carregando Meta Ads…
      </p>
    );
  }

  if (primary) {
    return <ConnectedSummary clientId={clientId} accountId={primary.account_id} businessId={primary.business_id} label={primary.label} />;
  }

  if (!integration.data?.connected) {
    return <ConnectPrompt />;
  }

  return <LinkAccountPicker clientId={clientId} />;
}
