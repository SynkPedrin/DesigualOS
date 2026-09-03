/**
 * Cliente do canal WebSocket único do backend (apps/api/src/ws/routes.ts):
 * broadcast simples pra todo cliente conectado, sem filtro por usuário
 * (o servidor ainda não tem sessão por conexão WS, só REST tem auth — ver
 * comentário lá). Por isso este cliente só usa os eventos pra invalidar
 * queries do React Query e nunca pra exibir dado sensível direto do payload.
 */
export interface WsEvent {
  type: 'execution.progress' | 'execution.completed' | 'node.status' | 'studio.job.progress' | 'agent.thinking' | 'dm.received';
  payload: Record<string, unknown>;
}

const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function wsUrl(): string | null {
  // Modo mock: MSW não simula WebSocket, então nem tenta conectar (evita um
  // erro de conexão barulhento no console em todo ambiente sem API real).
  if (API_MODE !== 'live' || !API_BASE_URL) return null;
  try {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    return url.toString();
  } catch {
    return null;
  }
}

type Listener = (event: WsEvent) => void;

/**
 * Uma única conexão WS compartilhada pela aba inteira, não uma por
 * componente: React monta/desmonta hooks o tempo todo (navegação entre
 * telas), uma conexão por hook geraria dezenas de sockets abrindo e
 * fechando à toa. Reconecta sozinho com backoff exponencial (1s a 15s) e só
 * fica de pé enquanto alguém estiver de fato escutando.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectDelayMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.connect();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  private connect() {
    if (this.socket || this.reconnectTimer) return;
    const url = wsUrl();
    if (!url) return;

    this.manuallyClosed = false;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsEvent;
        this.listeners.forEach((listener) => listener(parsed));
      } catch {
        // evento não é JSON válido, ignora
      }
    };
    socket.onopen = () => {
      this.reconnectDelayMs = 1000; // volta ao delay mínimo depois de uma conexão bem-sucedida
    };
    socket.onclose = () => {
      this.socket = null;
      if (!this.manuallyClosed && this.listeners.size > 0) this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15_000);
  }

  private disconnect() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();
