import type { FastifyInstance } from 'fastify';
import { subscribeToWsEvents } from '@desigual-os/orchestrator';
import { resolveOrProvisionUser, verifySupabaseToken } from '@desigual-os/auth';

function getMasterEmails(): ReadonlySet<string> {
  return new Set(
    (process.env.MASTER_USER_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

interface WsSocket {
  send: (data: string) => void;
  readyState: number;
  close: (code?: number, reason?: string) => void;
  on: (event: 'close', listener: () => void) => void;
}

/**
 * Canal WebSocket único (seção 9): execution.progress, execution.completed,
 * node.status, studio.job.progress, agent.thinking, dm.received,
 * message.delta. A conexão exige um token de sessão Supabase válido
 * (`?token=` na URL — o WebSocket nativo do browser não permite header
 * Authorization no handshake). Eventos operacionais seguem em broadcast (sem
 * dado de usuário); `dm.received` carrega conteúdo de mensagem direta e só é
 * entregue a quem é remetente ou destinatário dela, nunca a toda conexão
 * aberta. `message.delta` (texto de resposta em progresso/pronto de uma
 * conversa do Chat) segue a mesma regra de `conversations.visibility` já
 * aplicada em POST /chat: pública vai pra todo mundo conectado, privada só
 * pro dono (ver publishMessageDelta no worker).
 */
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  const clients = new Map<WsSocket, string>();

  app.get('/ws', { websocket: true }, async (socket: WsSocket, request) => {
    const token = (request.query as Record<string, string | undefined> | undefined)?.token;
    const supabaseUrl = process.env.SUPABASE_URL;

    if (!token || !supabaseUrl) {
      socket.close(4401, 'Missing auth token');
      return;
    }

    try {
      const claims = await verifySupabaseToken(token, supabaseUrl);
      const user = await resolveOrProvisionUser(claims, getMasterEmails());
      if (!user.active) {
        socket.close(4403, 'User account is deactivated');
        return;
      }
      clients.set(socket, user.id);
    } catch {
      socket.close(4401, 'Invalid or expired token');
      return;
    }

    socket.on('close', () => clients.delete(socket));
  });

  subscribeToWsEvents((event) => {
    const message = JSON.stringify(event);
    for (const [client, userId] of clients) {
      if (client.readyState !== 1) continue;
      if (event.type === 'dm.received') {
        const payload = event.payload as { sender_id?: string; recipient_id?: string };
        if (payload.sender_id !== userId && payload.recipient_id !== userId) continue;
      }
      if (event.type === 'message.delta') {
        const payload = event.payload as { owner_user_id?: string; visibility?: string };
        if (payload.visibility === 'private' && payload.owner_user_id !== userId) continue;
      }
      client.send(message);
    }
  });
}
