'use client';

import { useEffect, useState } from 'react';
import { Check, FileText, Link2, Unlink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectNotion, useDisconnectNotion, useNotionIntegration } from '@/hooks/use-notion-integration';
import { ApiRequestError } from '@/lib/api/client';

/**
 * "O colaborador clica, conecta no Notion dele, e depois de conectar uma vez
 * fica sempre conectado" (pedido da operação, 28/09/2026).
 *
 * O card é o mesmo do ClickUp na forma, mas tem uma diferença de conteúdo que
 * importa: ele mostra os DESTINOS. Uma integração do Notion só enxerga as
 * páginas que a pessoa liberou na hora de conectar, e conectar sem liberar
 * nenhuma é silencioso — o Notion aceita, o card diria "conectado", e o
 * primeiro `@notion` falharia sem explicação. Melhor a tela avisar antes.
 */
const CALLBACK_MESSAGES: Record<string, { text: string; tone: 'ok' | 'erro' }> = {
  conectado: { text: 'Notion conectado. Agora é só usar @notion no chat.', tone: 'ok' },
  recusado: { text: 'A conexão foi recusada no Notion. Nada mudou aqui.', tone: 'erro' },
  erro_config: { text: 'O servidor está sem as credenciais do Notion configuradas.', tone: 'erro' },
  erro_parametros: { text: 'O Notion devolveu um retorno incompleto. Tente conectar de novo.', tone: 'erro' },
  erro_state: { text: 'O pedido de conexão expirou ou não confere. Tente conectar de novo.', tone: 'erro' },
  erro_troca: { text: 'Não foi possível concluir a autorização no Notion. Tente de novo.', tone: 'erro' },
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function NotionIntegrationSection() {
  const { data: status, isPending } = useNotionIntegration();
  const connect = useConnectNotion();
  const disconnect = useDisconnectNotion();
  const [callbackMessage, setCallbackMessage] = useState<{ text: string; tone: 'ok' | 'erro' } | null>(null);

  // Lido de window.location em vez de useSearchParams, igual ao card do
  // ClickUp: evita exigir Suspense boundary só pra mostrar um aviso.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('notion');
    if (!param) return;
    setCallbackMessage(CALLBACK_MESSAGES[param] ?? null);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  if (isPending) return <Skeleton className="h-24 w-full" />;

  const conectado = status?.connected === true;
  const semDestino = conectado && (status?.destinos?.length ?? 0) === 0;

  return (
    <div className="mt-4 rounded-lg border border-grafite-elevado p-4">
      {callbackMessage && (
        <p
          className={`mb-3 rounded-md px-3 py-2 text-sm ${
            callbackMessage.tone === 'ok' ? 'bg-sinal/10 text-sinal' : 'bg-erro/10 text-erro'
          }`}
        >
          {callbackMessage.text}
        </p>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium text-branco-cru">
            <FileText size={16} className="text-nevoa" />
            Notion
          </p>
          <p className="mt-1 text-sm text-nevoa">
            {conectado
              ? `Conectado${status?.workspace_name ? ` a ${status.workspace_name}` : ''}. Use @notion no chat pra mandar um briefing pra lá.`
              : 'Conecte sua conta pra mandar briefings e análises direto pro seu Notion com @notion.'}
          </p>
        </div>
        {conectado && <Check size={16} className="mt-1 shrink-0 text-sinal" />}
      </div>

      {status?.configured === false && (
        <p className="mb-3 rounded-md bg-erro/10 px-3 py-2 text-sm text-erro">
          O servidor ainda não tem as credenciais do Notion. Fale com o Admin.
        </p>
      )}

      {semDestino && (
        <p className="mb-3 rounded-md bg-erro/10 px-3 py-2 text-sm text-erro">
          Conectado, mas sem acesso a nenhuma página. No Notion, abra a página onde os arquivos devem nascer →{' '}
          <strong>•••</strong> → <strong>Conexões</strong> → adicione o Desigual OS.
        </p>
      )}

      {conectado && !semDestino && (
        <p className="mb-3 text-xs text-nevoa">
          Os arquivos nascem em <strong>{status?.destinos?.[0]?.title}</strong>.
        </p>
      )}

      <div className="flex gap-2">
        {conectado ? (
          <button
            type="button"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="inline-flex items-center gap-2 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa transition-colors hover:text-branco-cru disabled:opacity-40"
          >
            <Unlink size={14} />
            {disconnect.isPending ? 'Desconectando…' : 'Desconectar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => connect.mutate()}
            disabled={connect.isPending || status?.configured === false}
            className="inline-flex items-center gap-2 rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Link2 size={14} />
            {connect.isPending ? 'Abrindo o Notion…' : 'Conectar Notion'}
          </button>
        )}
      </div>

      {connect.isError && (
        <p className="mt-2 text-sm text-erro">{errorMessage(connect.error, 'Não consegui iniciar a conexão.')}</p>
      )}
    </div>
  );
}
