'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { realtimeClient, type WsEvent } from '@/lib/realtime/ws-client';

/**
 * Ponte entre o canal WS do backend e o cache do React Query: em vez de
 * cada tela reimplementar o parsing dos eventos, isso só invalida as
 * queries afetadas e deixa o refetch normal (com auth, com os mappers de
 * contracts.ts) trazer o dado atualizado — o WS aqui é só o gatilho, nunca
 * a fonte do dado exibido. O polling que já existia em cada hook continua
 * de pé como rede de segurança (reconexão perdida, evento raro que não
 * mapeamos aqui); isso só faz a atualização comum acontecer na hora.
 */
export function useRealtimeEvents(): void {
  const queryClient = useQueryClient();

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
          break;
        case 'studio.job.progress':
          queryClient.invalidateQueries({ queryKey: ['studio', 'jobs'] });
          if (event.payload.status === 'completed') {
            queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
          }
          break;
        default:
          break;
      }
    }

    return realtimeClient.subscribe(handleEvent);
  }, [queryClient]);
}
