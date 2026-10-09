'use client';

import { useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import {
  useConnectMicrosoftCalendar,
  useLinkMicrosoftCalendarAccount,
  useMicrosoftCalendarAccounts,
  useMicrosoftCalendarIntegration,
  useMicrosoftCalendarList,
  useSyncMicrosoftCalendarAccount,
} from '@/hooks/use-microsoft-calendar';

/**
 * Banner de conexão do Microsoft 365/Outlook Calendar na página /calendar
 * (07/10/2026, pedido explícito do usuário: "o calendário que a operação vai
 * usar é o do Outlook"). Três estados, idênticos ao GoogleCalendarConnect:
 * desconectado → conectado sem agenda vinculada → vinculado (com sync manual).
 */
export function MicrosoftCalendarConnect() {
  const integration = useMicrosoftCalendarIntegration();
  const connect = useConnectMicrosoftCalendar();
  const contas = useMicrosoftCalendarAccounts();
  const agendasMicrosoft = useMicrosoftCalendarList(integration.data?.connected === true && (contas.data?.length ?? 0) === 0);
  const vincular = useLinkMicrosoftCalendarAccount();
  const sincronizar = useSyncMicrosoftCalendarAccount();
  const [selecionada, setSelecionada] = useState('');

  if (integration.isPending || contas.isPending) return null;

  const contaVinculada = contas.data?.[0] ?? null;

  if (contaVinculada) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-xs">
        <span className="text-nevoa">
          Outlook: <span className="text-branco-cru">{contaVinculada.external_calendar_id}</span>
          {contaVinculada.last_synced_at && ` · sincronizado ${new Date(contaVinculada.last_synced_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
        </span>
        <button
          type="button"
          onClick={() => sincronizar.mutate(contaVinculada.id)}
          disabled={sincronizar.isPending}
          className="flex items-center gap-1 rounded-md border border-grafite-elevado px-2 py-1 text-nevoa hover:border-roxo-eletrico/50 hover:text-branco-cru"
        >
          <RefreshCw size={11} className={sincronizar.isPending ? 'animate-spin' : ''} /> Sincronizar agora
        </button>
      </div>
    );
  }

  if (!integration.data?.connected) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-xs">
        <span className="text-nevoa">Conecte seu Outlook/Microsoft 365 pra ver seus compromissos reais aqui.</span>
        <button
          type="button"
          onClick={() => connect.mutate()}
          disabled={connect.isPending || integration.data?.configured === false}
          className="flex items-center gap-1 rounded-md bg-roxo-eletrico px-2 py-1 text-branco-cru hover:opacity-90"
        >
          <Link2 size={11} /> Conectar Outlook
        </button>
      </div>
    );
  }

  // Conectado, mas ainda sem agenda escolhida.
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-xs">
      <span className="text-nevoa">Outlook conectado, qual agenda é a sua?</span>
      <select value={selecionada} onChange={(e) => setSelecionada(e.target.value)} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-branco-cru">
        <option value="">Selecione…</option>
        {(agendasMicrosoft.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name ?? c.id}
            {c.is_default ? ' (principal)' : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selecionada || vincular.isPending}
        onClick={() => vincular.mutate(selecionada)}
        className="rounded-md bg-roxo-eletrico px-2 py-1 text-branco-cru disabled:opacity-40"
      >
        Vincular
      </button>
    </div>
  );
}
