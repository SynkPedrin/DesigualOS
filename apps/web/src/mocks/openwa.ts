import { http, HttpResponse } from 'msw';

/**
 * Mock do fluxo OpenWA (WhatsApp Business) para o modo mock do Desigual OS.
 *
 * Antes desta cobertura o handler antigo era só `GET /openwa/sessions`
 * (lista vazia). Com isso, em `NEXT_PUBLIC_API_MODE=mock`, o POST
 * `/openwa/sessions` batia num endpoint sem handler — o MSW em
 * `onUnhandledRequest: 'bypass'` repassava a requisição pra rede e o fetch
 * caía num 404 do próprio domínio, a mutação falhava, e a tela ficava presa no
 * spinner de "Aguardando QR Code" sem nunca exibir o código.
 *
 * Este módulo fecha o ciclo: criar sessão → status avança p/ `qr_ready` →
 * `GET /openwa/sessions/:id/qr` devolve o QR → gerenciar/reconectar/sync.
 * Segue o padrão do mock de Bento (`./bento-whatsapp.ts`): estado em memória,
 * nada aqui fala com OpenWA de verdade.
 */

const QR_MOCK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface MockSyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed';
  phase: string;
  processed_contacts: number;
  processed_chats: number;
  processed_messages: number;
  duplicate_messages: number;
  imported_media: number;
  failures: Array<{ chatId?: string; message: string }>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface MockOpenwaSession {
  id: string;
  provider: string;
  external_session_id: string;
  owner_user_id: string;
  phone_number: string | null;
  push_name: string | null;
  status: string;
  engine_loaded: boolean;
  connected_at: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  counts: { contacts: number; conversations: number; messages: number };
  latest_sync: MockSyncJob | null;
}

let seq = 0;
let mockSessions: MockOpenwaSession[] = [];

function makeSession(status: string, ownerUserId = 'user-1'): MockOpenwaSession {
  seq += 1;
  const now = new Date().toISOString();
  return {
    id: `openwa-mock-${seq}`,
    provider: 'openwa',
    external_session_id: `ext-mock-${seq}`,
    owner_user_id: ownerUserId,
    phone_number: status === 'ready' ? '5511999999999' : null,
    push_name: status === 'ready' ? 'Operação (mock)' : 'Operação',
    status,
    engine_loaded: status !== 'created' && status !== 'reconnecting',
    connected_at: status === 'ready' ? now : null,
    last_seen_at: status === 'ready' ? now : null,
    last_sync_at: status === 'ready' ? now : null,
    last_error: null,
    created_at: now,
    updated_at: now,
    counts: { contacts: 248, conversations: 63, messages: 1420 },
    latest_sync: null,
  };
}

/** Transições do mock: `created`/`reconnecting` → `qr_ready` (o "engine"
 * carrega na primeira resposta do GET, como o OpenWA na vida real), e
 * `authenticating` → `ready` (simula o scan do QR). */
function advance(session: MockOpenwaSession): MockOpenwaSession {
  if (session.status === 'created' || session.status === 'reconnecting') {
    return { ...session, status: 'qr_ready', engine_loaded: true };
  }
  if (session.status === 'authenticating') {
    return { ...session, status: 'ready', engine_loaded: true };
  }
  return session;
}

function findMockSession(id: string): MockOpenwaSession | null {
  return mockSessions.find((session) => session.id === id) ?? null;
}

function completedJob(): MockSyncJob {
  return {
    id: 'job-mock',
    status: 'completed',
    phase: 'completed',
    processed_contacts: 248,
    processed_chats: 63,
    processed_messages: 1420,
    duplicate_messages: 0,
    imported_media: 20,
    failures: [],
    error: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

export const openwaHandlers = [
  http.get('/openwa/sessions', () => {
    return HttpResponse.json({ sessions: mockSessions });
  }),

  http.post('/openwa/sessions', () => {
    const session = makeSession('created');
    mockSessions = [session, ...mockSessions];
    return HttpResponse.json(session, { status: 202 });
  }),

  http.get('/openwa/sessions/:id', ({ params }) => {
    const id = String(params.id);
    const session = findMockSession(id);
    if (!session) return HttpResponse.json({ error: 'Sessão não encontrada.' }, { status: 404 });
    const next = advance(session);
    if (next !== session) mockSessions = mockSessions.map((item) => (item.id === id ? next : item));
    return HttpResponse.json(next);
  }),

  http.get('/openwa/sessions/:id/qr', ({ params }) => {
    const session = findMockSession(String(params.id));
    if (!session) return HttpResponse.json({ error: 'Sessão não encontrada.' }, { status: 404 });
    if (session.status !== 'qr_ready') {
      return HttpResponse.json({ qr_code: null, status: session.status }, { status: 409 });
    }
    return HttpResponse.json({ qr_code: QR_MOCK, status: 'qr_ready', fetched_at: new Date().toISOString() });
  }),

  http.post('/openwa/sessions/:id/reconnect', ({ params }) => {
    const id = String(params.id);
    const session = findMockSession(id);
    if (!session) return HttpResponse.json({ error: 'Sessão não encontrada.' }, { status: 404 });
    mockSessions = mockSessions.map((item) => (item.id === id ? { ...item, status: 'reconnecting', engine_loaded: false } : item));
    const updated = findMockSession(id)!;
    return HttpResponse.json(updated);
  }),

  http.delete('/openwa/sessions/:id', ({ params }) => {
    const id = String(params.id);
    if (!findMockSession(id)) return HttpResponse.json({ error: 'Sessão não encontrada.' }, { status: 404 });
    mockSessions = mockSessions.filter((item) => item.id !== id);
    return new HttpResponse(null, { status: 200 });
  }),

  http.post('/openwa/sessions/:id/sync', ({ params }) => {
    const id = String(params.id);
    const session = findMockSession(id);
    if (!session) return HttpResponse.json({ error: 'Sessão não encontrada.' }, { status: 404 });
    const now = new Date().toISOString();
    mockSessions = mockSessions.map((item) => item.id === id ? { ...item, status: 'ready', engine_loaded: true, connected_at: now, last_seen_at: now, last_sync_at: now, latest_sync: { ...completedJob(), created_at: now } } : item);
    return HttpResponse.json({ ok: true });
  }),

  http.get('/openwa/sessions/:id/sync', () => {
    return HttpResponse.json({ jobs: [] });
  }),

  http.post('/openwa/sync-jobs/:id/retry', () => {
    return HttpResponse.json({ ok: true });
  }),

  http.get('/openwa/sessions/:id/events', () => {
    return HttpResponse.json({ events: [] });
  }),

  http.post('/openwa/webhook-events/:id/retry', () => {
    return HttpResponse.json({ ok: true });
  }),
];
