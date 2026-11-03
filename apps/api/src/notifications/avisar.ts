import { createLogger } from '@desigual-os/logging';
import { publishWsEvent } from '@desigual-os/orchestrator';

const logger = createLogger({ service: 'api:notificacoes' });

/**
 * "CHEGOU AVISO NO SINO" AO VIVO (03/11/2026). O sino buscava a lista a cada 20 s, então a mensagem nova e a tarefa
 * atribuída chegavam até 20 s depois e sem som. Quem grava a notificação chama isto DEPOIS de confirmar a gravação; a
 * tela de cada pessoa busca a lista na hora e toca o som do que é novo. O evento não leva dado: só o aviso, filtrado
 * por recipient_ids no servidor de WebSocket. Perder o evento só atrasa até o próximo refetch.
 */
export async function avisarNotificacoesNovas(userIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0 || process.env.VITEST) return;
  await publishWsEvent({ type: 'notificacao.nova', payload: { recipient_ids: ids } }).catch((error: unknown) => {
    logger.warn({ error }, 'Aviso ao vivo de notificação falhou (a tela recupera no próximo refetch)');
  });
}
