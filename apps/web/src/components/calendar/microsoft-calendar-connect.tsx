'use client';

import { useMemo, useState } from 'react';
import { pintarAgendas } from './cores-das-agendas';
import { Link2, RefreshCw } from 'lucide-react';
import { useMe } from '@/hooks/use-me';
import {
  useConnectMicrosoftCalendar,
  useLinkMicrosoftCalendarAccount,
  useMicrosoftCalendarAccounts,
  useMicrosoftCalendarIntegration,
  useMicrosoftCalendarList,
  useSyncMicrosoftCalendarAccount,
} from '@/hooks/use-microsoft-calendar';

/**
 * As agendas de quem está logado: as vinculadas, com nome e cor (Desigual, Manada Filmes...), e as da conta Outlook
 * que ainda não foram vinculadas, para o "+ Agenda" das abas. A API sincroniza a agenda na hora em que ela é vinculada.
 */
export function useAgendas() {
  const integration = useMicrosoftCalendarIntegration();
  const contas = useMicrosoftCalendarAccounts();
  const daConta = useMicrosoftCalendarList(integration.data?.connected === true);
  const vincular = useLinkMicrosoftCalendarAccount();
  const agendas = useMemo(() => pintarAgendas(contas.data ?? [], daConta.data ?? []), [contas.data, daConta.data]);
  const paraAdicionar = useMemo(() => {
    const jaVinculadas = new Set((contas.data ?? []).map((c) => c.external_calendar_id));
    return (daConta.data ?? []).filter((c) => !jaVinculadas.has(c.id)).map((c) => ({ id: c.id, nome: c.name ?? 'Agenda' }));
  }, [contas.data, daConta.data]);
  return { agendas, paraAdicionar, adicionar: (id: string) => vincular.mutate(id), adicionando: vincular.isPending };
}

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
  const { data: me } = useMe();
  // Lista das agendas da conta, para escolher a primeira. As outras (ex.: Manada Filmes) entram pelo "+ Agenda" das abas.
  const agendasMicrosoft = useMicrosoftCalendarList(integration.data?.connected === true);
  const vincular = useLinkMicrosoftCalendarAccount();
  const sincronizar = useSyncMicrosoftCalendarAccount();
  const [selecionada, setSelecionada] = useState('');

  if (integration.isPending || contas.isPending) return null;

  const vinculadas = contas.data ?? [];
  const contaVinculada = vinculadas[0] ?? null;

  if (contaVinculada) {
    const ultima = vinculadas.map((c) => c.last_synced_at).filter(Boolean).sort().pop();
    return (
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-xs">
        <span className="text-nevoa">
          {/*
            * O NOME DE QUEM CONECTOU, não o id da agenda (14/10/2026, pedido do
            * Pedro). O id do Outlook é uma cadeia de 150 caracteres que não diz
            * nada a ninguém; e a conta listada aqui é sempre a de quem está
            * logado (a API filtra por usuário), então o nome certo é o dele.
            */}
          Outlook: <span className="text-branco-cru">{me?.name?.trim() || 'sua agenda'}</span>
          {ultima && ` · sincronizado ${new Date(ultima).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
        </span>
        <button
          type="button"
          onClick={() => vinculadas.forEach((c) => sincronizar.mutate(c.id))}
          disabled={sincronizar.isPending}
          className="ml-auto flex items-center gap-1 rounded-md border border-grafite-elevado px-2 py-1 text-nevoa hover:border-roxo-eletrico/50 hover:text-branco-cru"
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
