import type { FastifyInstance } from 'fastify';
import { subscribeToWsEvents } from '@desigual-os/orchestrator';
import { loadUserAccess, resolveOrProvisionUser, verifySupabaseToken } from '@desigual-os/auth';
import { tenantSharingScope } from '../lib/access';

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
 * Até quando este socket pode continuar recebendo evento.
 *
 * Achado da auditoria de prontidão (18/09/2026): a conexão era autenticada UMA
 * VEZ, no aperto de mão, e depois vivia para sempre. Como toda rota HTTP
 * reverifica o JWT a cada request (ver requireAuth), o WebSocket era o único
 * lugar do sistema onde desativar uma conta (`users.active = false`) ou um
 * token expirar NÃO tinha efeito nenhum: quem já estava conectado seguia
 * recebendo `dm.received` e `message.delta` da equipe indefinidamente - bastava
 * não fechar a aba.
 *
 * A correção mais barata e honesta é não deixar o socket sobreviver ao token
 * que o abriu. O navegador reconecta com um token novo (o Supabase renova
 * sozinho), e a reconexão passa de novo pela checagem de `active`. O buraco
 * deixa de ser ilimitado e passa a ser, no pior caso, o tempo de vida do
 * token.
 */
function expiracaoDoToken(claims: { raw: Record<string, unknown> }): number | null {
  const exp = claims.raw.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
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
interface WsClientInfo {
  userId: string;
  /** null = master (alcance amplo já existente); senão, os clientes/colegas da própria organização. */
  scope: { allowedClientIds: string[]; teammateUserIds: string[] } | null;
}

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  const clients = new Map<WsSocket, WsClientInfo>();

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
      // P0-02 (22/09/2026): calculado UMA VEZ na conexão, não por evento —
      // broadcast roda pra toda mensagem que chega, então uma query de banco
      // por evento por cliente conectado não escala. Master é `null` (mesmo
      // alcance amplo que já tinha em GET /conversations).
      const access = await loadUserAccess(user.id);
      const scope = access.roles.includes('master') ? null : await tenantSharingScope(user.id);
      clients.set(socket, { userId: user.id, scope });

      // Fecha sozinho quando o token vence. `unref` pra este temporizador não
      // segurar o processo vivo num desligamento gracioso.
      const expiraEm = expiracaoDoToken(claims);
      if (expiraEm !== null) {
        const faltam = expiraEm - Date.now();
        // Token já vencido não deveria passar pelo jwtVerify acima; se passar
        // (relógio fora de sincronia entre máquinas, ver §68), fecha na hora em
        // vez de tratar como sessão eterna.
        if (faltam <= 0) {
          clients.delete(socket);
          socket.close(4401, 'Invalid or expired token');
          return;
        }
        const prazo = setTimeout(() => {
          clients.delete(socket);
          socket.close(4401, 'Token expired, reconnect');
        }, faltam);
        prazo.unref?.();
        socket.on('close', () => clearTimeout(prazo));
      }
    } catch {
      socket.close(4401, 'Invalid or expired token');
      return;
    }

    socket.on('close', () => clients.delete(socket));
  });

  subscribeToWsEvents((event) => {
    const message = JSON.stringify(event);
    for (const [client, info] of clients) {
      if (client.readyState !== 1) continue;
      const { userId, scope } = info;
      if (event.type === 'dm.received') {
        const payload = event.payload as { sender_id?: string; recipient_id?: string };
        if (payload.sender_id !== userId && payload.recipient_id !== userId) continue;
      }
      if (event.type === 'message.delta') {
        const payload = event.payload as { owner_user_id?: string; visibility?: string; client_id?: string | null };
        if (payload.visibility === 'private' && payload.owner_user_id !== userId) continue;
        /**
         * P0-02 (22/09/2026, E04): "pública" era pública pra TODA conexão
         * aberta, de qualquer organização — o mesmo escopo que já vale pra
         * GET /conversations precisa valer aqui, senão o texto de uma
         * conversa de outra organização chega pelo canal que devolveu o
         * dado escondido pela REST. `scope === null` é master (alcance
         * amplo já existente, decisão preservada).
         */
        if (payload.visibility === 'public' && scope !== null && payload.owner_user_id !== userId) {
          const emEscopo = payload.client_id
            ? scope.allowedClientIds.includes(payload.client_id)
            : scope.teammateUserIds.includes(payload.owner_user_id ?? '');
          if (!emEscopo) continue;
        }
      }
      client.send(message);
    }
  });
}
