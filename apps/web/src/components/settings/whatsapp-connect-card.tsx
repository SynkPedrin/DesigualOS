'use client';

import { useState } from 'react';
import { MessageCircle, Unplug } from 'lucide-react';
import { useMe } from '@/hooks/use-me';
import { useOrganizationConnectors, useRemoveOrganizationConnector, useSaveOrganizationConnector, useWhatsappHealth } from '@/hooks/use-organization-connectors';
import { ApiRequestError } from '@/lib/api/client';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * WhatsAppConnectCard (07/10/2026) — pedido explícito do usuário: vincular
 * uma instância já conectada num vendor externo (hoje: W-API, instância
 * criada e pareada pelo próprio painel deles), acompanhar status, e
 * desconectar. NUNCA mostra o token depois de salvo — o GET devolve só a
 * máscara (backend, connectors/routes.ts), e este componente nem guarda o
 * valor digitado em estado depois do envio.
 *
 * O vendor é fixo em 'wapi' nesta forma deliberadamente: é o ÚNICO vendor
 * ativo hoje (ver communication-provider-resolver.ts). Evolution (self-host)
 * continua existindo no backend, sem UI própria ainda — ninguém pediu.
 */
export function WhatsAppConnectCard() {
  const { data: me } = useMe();
  const organizationId = me?.organizacao_ativa?.id ?? null;

  const conectores = useOrganizationConnectors(organizationId);
  const saude = useWhatsappHealth(organizationId);
  const salvar = useSaveOrganizationConnector(organizationId);
  const remover = useRemoveOrganizationConnector(organizationId);

  const [baseUrl, setBaseUrl] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [token, setToken] = useState('');

  if (!organizationId || conectores.isPending || saude.isPending) {
    return <Skeleton className="h-28 w-full" />;
  }

  const conector = conectores.data?.connectors.find((c) => c.provider === 'whatsapp') ?? null;
  const erro = salvar.error instanceof ApiRequestError ? salvar.error.message : salvar.isError ? 'Não foi possível salvar.' : null;

  if (conector) {
    return (
      <div className="rounded-lg border border-grafite-elevado bg-grafite p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MessageCircle size={18} className="text-nevoa" />
            <p className="font-heading text-base font-semibold text-branco-cru">WhatsApp</p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${saude.data?.connected ? 'bg-sucesso/15 text-sucesso' : 'bg-aviso/15 text-aviso'}`}>
            {saude.data?.connected ? 'Conectado' : 'Vinculado, verificando conexão'}
          </span>
        </div>
        <p className="mt-2 font-mono text-[11px] text-nevoa">
          instância {conector.credentials.instanceId ?? conector.credentials.instance ?? '—'}
          {saude.data?.detail ? ` · ${saude.data.detail}` : ''}
        </p>
        <button
          type="button"
          onClick={() => remover.mutate('whatsapp')}
          disabled={remover.isPending}
          className="mt-3 flex items-center gap-1.5 rounded-md border border-erro/40 px-3 py-1.5 text-xs text-erro hover:bg-erro/10 disabled:opacity-50"
        >
          <Unplug size={13} /> Desconectar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite p-4">
      <div className="flex items-center gap-2.5">
        <MessageCircle size={18} className="text-nevoa" />
        <p className="font-heading text-base font-semibold text-branco-cru">WhatsApp</p>
      </div>
      <p className="mt-1 text-xs text-nevoa">Vincule a instância que você já conectou no painel da W-API.</p>

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate(
            { provider: 'whatsapp', credentials: { vendor: 'wapi', baseUrl, instanceId, token } },
            { onSuccess: () => setToken('') },
          );
        }}
      >
        <input
          type="text"
          placeholder="Base URL (ex.: https://api.w-api.app)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
          className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-xs text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <input
          type="text"
          placeholder="ID da instância"
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          required
          className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-xs text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <input
          type="password"
          placeholder="Token da instância"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-xs text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
        />
        {erro && <p className="text-xs text-erro">{erro}</p>}
        <button
          type="submit"
          disabled={salvar.isPending}
          className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru transition-all hover:opacity-90 disabled:opacity-50"
        >
          {salvar.isPending ? 'Vinculando…' : 'Vincular'}
        </button>
      </form>
    </div>
  );
}
