'use client';

import { useEffect, useState } from 'react';
import { Check, Link2, RefreshCw, Unlink } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useClickUpIntegration, useConnectClickUp, useDisconnectClickUp, useSyncClickUp } from '@/hooks/use-clickup-integration';
import { ApiRequestError } from '@/lib/api/client';

/** Mensagens que o callback do OAuth devolve em ?clickup=... (ver apps/api/src/integrations/routes.ts). */
const CALLBACK_MESSAGES: Record<string, { text: string; tone: 'ok' | 'erro' }> = {
  conectado: { text: 'ClickUp conectado com sucesso.', tone: 'ok' },
  erro_config: { text: 'O servidor está sem as credenciais do ClickUp configuradas.', tone: 'erro' },
  erro_parametros: { text: 'O ClickUp devolveu um retorno incompleto. Tente conectar de novo.', tone: 'erro' },
  erro_state: { text: 'O pedido de conexão expirou ou não confere. Tente conectar de novo.', tone: 'erro' },
  erro_troca: { text: 'Não foi possível concluir a autorização no ClickUp. Tente de novo.', tone: 'erro' },
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function ClickUpIntegrationSection() {
  const { data: status, isPending } = useClickUpIntegration();
  const connect = useConnectClickUp();
  const disconnect = useDisconnectClickUp();
  const sync = useSyncClickUp();
  const [callbackMessage, setCallbackMessage] = useState<{ text: string; tone: 'ok' | 'erro' } | null>(null);

  // Lido de window.location em vez de useSearchParams de propósito: evita
  // exigir Suspense boundary/prerender só pra mostrar um aviso pós-redirect.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('clickup');
    if (!param) return;
    setCallbackMessage(CALLBACK_MESSAGES[param] ?? null);
    // Limpa a query pra não repetir o aviso a cada re-render/refresh.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  return (
    <>
      <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Integrações</h2>

      {callbackMessage && (
        <p className={`mb-4 rounded-md px-3 py-2 text-sm ${callbackMessage.tone === 'ok' ? 'bg-sinal/10 text-sinal' : 'bg-erro/10 text-erro'}`}>
          {callbackMessage.text}
        </p>
      )}

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="rounded-lg border border-grafite-elevado p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-branco-cru">ClickUp</p>
              <p className="mt-0.5 font-mono text-[11px] text-nevoa">
                {status?.connected ? (
                  <span className="inline-flex items-center gap-1 text-sinal">
                    <Check size={12} /> Conectado
                  </span>
                ) : (
                  'Não conectado'
                )}
              </p>
            </div>
          </div>

          {status?.connected ? (
            <>
              <dl className="mb-4 space-y-1 font-mono text-[11px] text-nevoa">
                <div className="flex gap-2">
                  <dt>Workspace:</dt>
                  <dd className="text-branco-cru">{status.workspace_name ?? '-'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>Última sincronização:</dt>
                  <dd className="text-branco-cru">{formatDate(status.last_synced_at)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50"
                >
                  <RefreshCw size={14} className={sync.isPending ? 'animate-spin' : undefined} />
                  {sync.isPending ? 'Importando…' : 'Importar clientes'}
                </button>
                <button
                  type="button"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa transition-colors hover:border-erro/50 hover:text-erro disabled:opacity-50"
                >
                  <Unlink size={14} />
                  Desconectar
                </button>
              </div>
              {sync.isSuccess && (
                <p className="mt-2 text-[11px] text-sinal">
                  {sync.data.spaces_found} space(s) no ClickUp · {sync.data.clients_created} cliente(s) novo(s) ·{' '}
                  {sync.data.clients_updated} atualizado(s).
                </p>
              )}
              {sync.isError && <p className="mt-2 text-[11px] text-erro">{errorMessage(sync.error, 'Não foi possível importar.')}</p>}
              {disconnect.isError && (
                <p className="mt-2 text-[11px] text-erro">{errorMessage(disconnect.error, 'Não foi possível desconectar.')}</p>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-nevoa">
                Conecte sua conta pra que os agentes e a área de Clientes leiam suas tarefas reais. Você pode
                desconectar quando quiser, sem precisar chamar o administrador.
              </p>
              <button
                type="button"
                onClick={() => connect.mutate()}
                disabled={connect.isPending || status?.configured === false}
                className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none"
              >
                <Link2 size={14} />
                {connect.isPending ? 'Abrindo o ClickUp…' : 'Conectar ClickUp'}
              </button>
              {status?.configured === false && (
                <p className="mt-2 text-[11px] text-erro">
                  O servidor ainda não tem as credenciais OAuth do ClickUp configuradas.
                </p>
              )}
              {connect.isError && <p className="mt-2 text-[11px] text-erro">{errorMessage(connect.error, 'Não foi possível iniciar a conexão.')}</p>}
            </>
          )}
        </div>
      )}
    </>
  );
}

export function ClickUpIntegrationCard() {
  return (
    <Surface level="grafite" className="p-5">
      <ClickUpIntegrationSection />
    </Surface>
  );
}
