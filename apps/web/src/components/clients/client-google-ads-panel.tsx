'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { Link2, Loader2, Unlink } from 'lucide-react';
import { useGoogleAdsIntegration, useConnectGoogleAds, useGoogleAdsAccounts } from '@/hooks/use-google-ads-integration';
import {
  useClientGoogleAdsAccounts,
  useLinkClientGoogleAdsAccount,
  useUnlinkClientGoogleAdsAccount,
  useClientGoogleAdsSummary,
} from '@/hooks/use-client-google-ads-accounts';
import { ApiRequestError } from '@/lib/api/client';

/**
 * Cliente → Mídia → Google Ads (§43-45 do prompt de refinamento, 06/10/2026).
 * Mesma regra fundamental do Meta Ads (ver client-meta-ads-panel.tsx):
 * mídia é sempre vinculada a ESTE cliente, o isolamento é garantido no
 * backend (clients/routes.ts + google-ads-accounts.test.ts).
 *
 * Diferença de UX em relação ao Meta: o Google não tem um "Business Manager"
 * com endpoint de listagem direta — a hierarquia é opcional (MCC), então o
 * primeiro campo é um Customer ID de MCC digitado à mão (vazio = contas
 * diretas do login), não um <select> alimentado por uma chamada própria.
 */
function formatCurrency(value: number | null, currency = 'BRL'): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR').format(Math.round(value));
}

function GoogleAdsLogo() {
  return <Image src="/logos/google-ads.webp" alt="" width={20} height={20} className="rounded-sm" />;
}

function ConnectPrompt() {
  const connect = useConnectGoogleAds();
  const integration = useGoogleAdsIntegration();
  return (
    <div className="rounded-lg border border-grafite-elevado p-4">
      <div className="mb-2 flex items-center gap-2">
        <GoogleAdsLogo />
        <p className="text-sm font-semibold text-branco-cru">Google Ads</p>
      </div>
      <p className="mb-3 text-xs text-nevoa">
        Conecte sua conta Google Ads pra vincular o Customer ID deste cliente. A conexão é sua — outros clientes usam
        o mesmo login sem misturar dados entre si.
      </p>
      <button
        type="button"
        onClick={() => connect.mutate()}
        disabled={connect.isPending || integration.data?.configured === false}
        className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50"
      >
        <Link2 size={14} />
        {connect.isPending ? 'Abrindo o Google…' : 'Conectar Google Ads'}
      </button>
      {integration.data?.configured === false && (
        <p className="mt-2 text-[11px] text-erro">O servidor ainda não tem as credenciais OAuth do Google Ads configuradas.</p>
      )}
      {connect.isError && <p className="mt-2 text-[11px] text-erro">Não foi possível iniciar a conexão.</p>}
    </div>
  );
}

function LinkAccountPicker({ clientId }: { clientId: string }) {
  const [loginCustomerId, setLoginCustomerId] = useState('');
  const [searchedMcc, setSearchedMcc] = useState<string | null>(null);
  const accounts = useGoogleAdsAccounts(searchedMcc, searchedMcc !== null);
  const link = useLinkClientGoogleAdsAccount(clientId);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  const options = accounts.data?.accounts ?? [];

  return (
    <div className="rounded-lg border border-grafite-elevado p-4">
      <div className="mb-2 flex items-center gap-2">
        <GoogleAdsLogo />
        <p className="text-sm font-semibold text-branco-cru">Google Ads conectado — vincule a conta deste cliente</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            MCC (Manager Account) — deixe vazio se a conta não vive sob um MCC
          </label>
          <div className="flex gap-2">
            <input
              value={loginCustomerId}
              onChange={(event) => setLoginCustomerId(event.target.value.replace(/\D/g, ''))}
              placeholder="Ex.: 1234567890"
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setSelectedCustomerId('');
                setSearchedMcc(loginCustomerId || '');
              }}
              className="shrink-0 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
            >
              Buscar contas
            </button>
          </div>
        </div>

        {searchedMcc !== null && (
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Customer ID</label>
            {accounts.isPending ? (
              <p className="flex items-center gap-2 py-2 text-xs text-nevoa">
                <Loader2 size={12} className="animate-spin" /> Buscando contas…
              </p>
            ) : accounts.isError ? (
              <p className="py-2 text-xs text-erro">
                {accounts.error instanceof ApiRequestError ? accounts.error.message : 'Não foi possível listar as contas.'}
              </p>
            ) : (
              <select
                value={selectedCustomerId}
                onChange={(event) => setSelectedCustomerId(event.target.value)}
                className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
              >
                <option value="">Selecione…</option>
                {options.map((a) => (
                  <option key={a.customer_id} value={a.customer_id}>
                    {a.descriptive_name ?? a.customer_id} ({a.currency_code ?? '—'})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={!selectedCustomerId || link.isPending}
          onClick={() => {
            const account = options.find((a) => a.customer_id === selectedCustomerId);
            link.mutate({
              customer_id: selectedCustomerId,
              login_customer_id: loginCustomerId || undefined,
              label: account?.descriptive_name ?? undefined,
              is_primary: true,
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40"
        >
          {link.isPending ? 'Vinculando…' : 'Vincular a este cliente'}
        </button>
        {link.isError && (
          <p className="text-[11px] text-erro">{link.error instanceof ApiRequestError ? link.error.message : 'Não foi possível vincular a conta.'}</p>
        )}
      </div>
    </div>
  );
}

function ConnectedSummary({ clientId, customerId, loginCustomerId, label }: { clientId: string; customerId: string; loginCustomerId: string | null; label: string | null }) {
  const summary = useClientGoogleAdsSummary(clientId, true);
  const unlink = useUnlinkClientGoogleAdsAccount(clientId);

  const insights = summary.data && summary.data.connected && summary.data.data_available ? summary.data.insights : null;
  const campaigns = summary.data && summary.data.connected && summary.data.data_available ? summary.data.campaigns : [];
  const reason = summary.data && summary.data.connected && !summary.data.data_available ? summary.data.reason : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-grafite-elevado p-4">
        <div className="flex items-center gap-2">
          <GoogleAdsLogo />
          <div>
            <p className="text-sm font-semibold text-branco-cru">{label ?? customerId}</p>
            <p className="font-mono text-[11px] text-nevoa">
              {customerId}
              {loginCustomerId ? ` · MCC ${loginCustomerId}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => unlink.mutate(customerId)}
          disabled={unlink.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa transition-colors hover:border-erro/50 hover:text-erro disabled:opacity-50"
        >
          <Unlink size={12} /> Desvincular
        </button>
      </div>

      {summary.isPending ? (
        <p className="flex items-center gap-2 py-4 text-sm text-nevoa">
          <Loader2 size={14} className="animate-spin" /> Buscando dados no Google Ads…
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
              ['Conversões', formatNumber(insights?.conversions ?? null)],
              ['CTR', insights?.ctr != null ? `${insights.ctr.toFixed(2)}%` : '—'],
              ['CPC médio', formatCurrency(insights?.average_cpc ?? null)],
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
        </>
      )}
    </div>
  );
}

export function ClientGoogleAdsPanel({ clientId }: { clientId: string }) {
  const integration = useGoogleAdsIntegration();
  const accounts = useClientGoogleAdsAccounts(clientId);

  const primary = useMemo(() => accounts.data?.find((a) => a.is_primary) ?? accounts.data?.[0] ?? null, [accounts.data]);

  // 403 = o workspace builder desta pessoa não inclui "google_ads" — mesmo
  // raciocínio do painel de Meta Ads (client-meta-ads-panel.tsx).
  if (accounts.error instanceof ApiRequestError && accounts.error.status === 403) return null;

  if (integration.isPending || accounts.isPending) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-nevoa">
        <Loader2 size={15} className="animate-spin" /> Carregando Google Ads…
      </p>
    );
  }

  if (primary) {
    return <ConnectedSummary clientId={clientId} customerId={primary.customer_id} loginCustomerId={primary.login_customer_id} label={primary.label} />;
  }

  if (!integration.data?.connected) {
    return <ConnectPrompt />;
  }

  return <LinkAccountPicker clientId={clientId} />;
}
