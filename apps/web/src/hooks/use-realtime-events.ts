'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { realtimeClient, type WsEvent } from '@/lib/realtime/ws-client';
import { useSupabaseSession } from '@/hooks/use-supabase-session';

/**
 * Ponte entre o canal WS do backend e o cache do React Query: em vez de
 * cada tela reimplementar o parsing dos eventos, isso só invalida as
 * queries afetadas e deixa o refetch normal (com auth, com os mappers de
 * contracts.ts) trazer o dado atualizado - o WS aqui é só o gatilho, nunca
 * a fonte do dado exibido. O polling que já existia em cada hook continua
 * de pé como rede de segurança (reconexão perdida, evento raro que não
 * mapeamos aqui); isso só faz a atualização comum acontecer na hora.
 */
export function useRealtimeEvents(): void {
  const queryClient = useQueryClient();
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token ?? null;

  // O servidor exige um token de sessão no handshake do WS (query string
  // `?token=`, já que o WebSocket nativo do browser não manda Authorization).
  useEffect(() => {
    realtimeClient.setToken(accessToken);
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
          if (event.payload.status === 'completed') {
            queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
          }
          break;
        // Task criada/editada/apagada no ClickUp pra um cliente conhecido
        // (ver handleTaskChanged em apps/api/src/clickup/routes.ts): refaz o
        // GET /clients/:id/clickup/tasks - painel do cliente já aberto
        // atualiza sozinho, sem precisar sair e voltar.
        case 'clickup.task_changed': {
          const clientId = event.payload.client_id;
          if (typeof clientId === 'string') {
            queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'clickup-tasks'] });
          }
          break;
        }
        default:
          break;
      }
    }

    return realtimeClient.subscribe(handleEvent);
  }, [queryClient]);
}
