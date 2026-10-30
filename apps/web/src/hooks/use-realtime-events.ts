'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { realtimeClient, type WsEvent } from '@/lib/realtime/ws-client';
import { useSupabaseSession } from '@/hooks/use-supabase-session';
import { supabase } from '@/lib/supabase/client';
import { applyLiveInboxMessage, type LiveInboxMessage } from '@/hooks/use-inbox';
import { applyInternalChatEvent, recoverInternalChat, reportPresence } from '@/hooks/use-internal-chat';
import { useMe } from '@/hooks/use-me';

/**
 * Ponte entre o canal WS do backend e o cache do React Query: em vez de
 * cada tela reimplementar o parsing dos eventos, isso só invalida as
 * queries afetadas e deixa o refetch normal (com auth, com os mappers de
 * contracts.ts) trazer o dado atualizado - o WS aqui é só o gatilho, nunca
 * a fonte do dado exibido. O polling que já existia em cada hook continua
 * de pé como rede de segurança (reconexão perdida, evento raro que não
 * mapeamos aqui); isso só faz a atualização comum acontecer na hora.
 */
/**
 * "O Daily mudou", agrupado. Cada tarefa sincronizada do ClickUp avisa; com a conferência corrigindo centenas, vinha um
 * aviso a cada 1,5 s e a tela refazia TUDO do Daily (até membros e preferências) — e, pior, a busca podia trazer o valor
 * antigo de uma tarefa que a pessoa acabara de mudar, antes de o servidor gravar: a tarefa "aparecia e sumia"
 * (30/10/2026). Agora: uma atualização a cada 3 s no máximo, nunca no meio de um salvamento, e só do que a sincronia
 * muda.
 */
let atualizacaoDoDaily: ReturnType<typeof setTimeout> | null = null;
const MUDA_COM_A_SINCRONIA = ['tasks', 'tree', 'overview', 'inbox', 'detail', 'history'];
function atualizarDailyAgrupado(queryClient: QueryClient): void {
  if (atualizacaoDoDaily) return;
  const tentar = () => {
    if (queryClient.isMutating() > 0) { atualizacaoDoDaily = setTimeout(tentar, 1_500); return; } // salvando: espera
    atualizacaoDoDaily = null;
    for (const k of MUDA_COM_A_SINCRONIA) void queryClient.invalidateQueries({ queryKey: ['work', k] });
  };
  atualizacaoDoDaily = setTimeout(tentar, 3_000);
}

export function useRealtimeEvents(): void {
  const queryClient = useQueryClient();
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token ?? null;
  const { data: me } = useMe();
  // Ref, não dependência do efeito: o /me chegar não deve derrubar e reabrir o socket.
  const meId = useRef<string | null>(null);
  meId.current = me?.id ?? null;

  // O servidor exige um token de sessão no handshake do WS (query string
  // `?token=`, já que o WebSocket nativo do browser não manda Authorization).
  useEffect(() => {
    realtimeClient.setToken(accessToken);
  }, [accessToken]);

  // Token recusado pelo servidor: renova a sessão; o token novo chega por
  // useSupabaseSession e o setToken acima reconecta.
  useEffect(() => {
    realtimeClient.onAuthExpired = () => { void supabase.auth.refreshSession().catch(() => undefined); };
    return () => { realtimeClient.onAuthExpired = null; };
  }, []);

  // Presença da Comunicação: aba à vista = online; em segundo plano = ausente.
  // Só o estado de agora — nada de histórico de quanto tempo alguém ficou.
  useEffect(() => {
    if (!accessToken) return;
    const aoMudar = () => reportPresence(document.visibilityState === 'visible' ? 'online' : 'away');
    document.addEventListener('visibilitychange', aoMudar);
    return () => document.removeEventListener('visibilitychange', aoMudar);
  }, [accessToken]);

  useEffect(() => {
    function handleEvent(event: WsEvent) {
      switch (event.type) {
        case 'dm.received':
          queryClient.invalidateQueries({ queryKey: ['messages'] });
          break;
        case 'execution.completed':
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
          queryClient.invalidateQueries({ queryKey: ['executions'] });
          // Custo/tokens combinando todos os bots, instantâneo em QUALQUER aba
          // aberta (pedido do usuário, 2026-09-05): antes só a aba que mandou
          // a mensagem invalidava (chat-thread.tsx), então o Dashboard/Custos
          // numa aba separada só pegava no refetchInterval de 20s. O evento
          // chega aqui via Redis pub/sub -> WS pra qualquer cliente conectado,
          // então isso cobre todas as abas na hora que a execution fecha.
          queryClient.invalidateQueries({ queryKey: ['costs'] });
          break;
        // Sonda de status dos nós (~10s) e heartbeat: derruba o polling de 15s
        // da tela de Monitoramento pra atualização acontecer na hora.
        case 'node.status':
          queryClient.invalidateQueries({ queryKey: ['health', 'infrastructure'] });
          queryClient.invalidateQueries({ queryKey: ['health', 'events'] });
          break;
        case 'studio.job.progress':
          queryClient.invalidateQueries({ queryKey: ['studio', 'jobs'] });
          // Motion Engine (publishStage em otto-motion/pipeline.ts): o payload
          // carrega kind 'motion' + motion_id. Invalidar a query do card faz o
          // player atualizar na hora em vez de esperar o próximo poll de 4s.
          if (event.payload.kind === 'motion' && typeof event.payload.motion_id === 'string') {
            queryClient.invalidateQueries({ queryKey: ['motion', event.payload.motion_id] });
          }
          if (event.payload.status === 'completed') {
            queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
          }
          break;
        // Task criada/editada/apagada no ClickUp pra um cliente conhecido
        // (ver handleTaskChanged em apps/api/src/clickup/routes.ts): refaz o
        // GET /clients/:id/clickup/tasks - painel do cliente já aberto
        // atualiza sozinho, sem precisar sair e voltar.
        // Gestão da equipe (Hoje de quem administra): o trabalho mudou, refaz o painel.
        case 'gestao.mudou':
          queryClient.invalidateQueries({ queryKey: ['gestao'] });
          break;
        // Daily Tasks: uma tarefa mudou (sincronizada do ClickUp). Refaz o que está na tela: lista, gaveta e resumo.
        case 'work.mudou':
          atualizarDailyAgrupado(queryClient);
          break;
        case 'clickup.task_changed': {
          const clientId = event.payload.client_id;
          if (typeof clientId === 'string') {
            queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'clickup-tasks'] });
          }
          break;
        }
        // Mensagem nova, entrega/leitura ou progresso de sync do WhatsApp: a
        // Inbox atualiza na hora em vez de esperar o polling.
        case 'inbox.message': {
          // Conversa nova (ainda fora da lista) não tem onde encaixar: busca a lista.
          if (!applyLiveInboxMessage(queryClient, event.payload as unknown as LiveInboxMessage)) {
            queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
          }
          break;
        }
        case 'inbox.updated': {
          queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
          const threadId = event.payload.thread_id;
          if (typeof threadId === 'string') {
            queryClient.invalidateQueries({ queryKey: ['inbox-messages', threadId] });
            queryClient.invalidateQueries({ queryKey: ['inbox-thread', threadId] });
          }
          if (event.payload.sync === true) queryClient.invalidateQueries({ queryKey: ['openwa-sessions'] });
          break;
        }
        // Comunicação interna: o servidor só manda a quem pode ler a conversa.
        case 'chat.event':
          applyInternalChatEvent(queryClient, event.payload, meId.current);
          break;
        default:
          break;
      }
    }

    const pararDeOuvir = realtimeClient.subscribe(handleEvent);
    const pararReconexao = realtimeClient.onReconnect(() => recoverInternalChat(queryClient));
    return () => { pararDeOuvir(); pararReconexao(); };
  }, [queryClient]);
}
