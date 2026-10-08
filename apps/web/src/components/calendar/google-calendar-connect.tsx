'use client';

import { useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { useConnectGoogleCalendar, useGoogleCalendarIntegration, useGoogleCalendarList } from '@/hooks/use-google-calendar';
import { useLinkMemberCalendarAccount, useMemberCalendarAccounts, useSyncMemberCalendarAccount } from '@/hooks/use-google-calendar';

/**
 * Banner de conexão do Google Calendar na página /calendar (Parte F, §22-25
 * do prompt "CALENDAR + AUTOMATIONS + BENTO V2"). Três estados: desconectado
 * → conectado sem agenda vinculada → vinculado (com botão de sync manual,
 * já que a sync automática do worker roda periódica, não a cada abertura
 * de página — §25).
 */
export function GoogleCalendarConnect() {
  const integration = useGoogleCalendarIntegration();
  const connect = useConnectGoogleCalendar();
  const contas = useMemberCalendarAccounts();
  const agendasGoogle = useGoogleCalendarList(integration.data?.connected === true && (contas.data?.length ?? 0) === 0);
  const vincular = useLinkMemberCalendarAccount();
  const sincronizar = useSyncMemberCalendarAccount();
  const [selecionada, setSelecionada] = useState('');

  if (integration.isPending || contas.isPending) return null;

  const contaVinculada = contas.data?.[0] ?? null;

  if (contaVinculada) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-xs">
        <span className="text-nevoa">
          Google Calendar: <span className="text-branco-cru">{contaVinculada.external_calendar_id}</span>
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
        <span className="text-nevoa">Conecte seu Google Calendar pra ver seus compromissos reais aqui.</span>
        <button
          type="button"
          onClick={() => connect.mutate()}
          disabled={connect.isPending || integration.data?.configured === false}
          className="flex items-center gap-1 rounded-md bg-roxo-eletrico px-2 py-1 text-branco-cru hover:opacity-90"
        >
          <Link2 size={11} /> Conectar Google Calendar
        </button>
      </div>
    );
  }

  // Conectado, mas ainda sem agenda escolhida.
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-xs">
      <span className="text-nevoa">Google conectado — qual agenda é a sua?</span>
      <select value={selecionada} onChange={(e) => setSelecionada(e.target.value)} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-branco-cru">
        <option value="">Selecione…</option>
        {(agendasGoogle.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.summary ?? c.id}
            {c.primary ? ' (principal)' : ''}
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
